import type Anthropic from "@anthropic-ai/sdk";
import type { CapturedForm, PageState } from "@treeline/acquire";
import type { PageInterpretation, FormFillAssertion, ContentPresenceAssertion } from "./types.js";
import { decideTier } from "./routing.js";
import { getAnthropicClient } from "./client.js";
import { HAIKU_MODEL, SONNET_MODEL } from "./models.js";

const MAX_INTERPRETATION_ATTEMPTS = 2;
const MAX_PROPOSAL_ATTEMPTS = 2;
const MAX_KEY_DATA_ENTITIES = 15;

const UNVERIFIED_GUESS_CAVEAT =
  "This success assertion is an unverified guess: treeline never fills or submits real forms, so it has not observed this page's actual post-submission behavior.";

const OBSERVED_ELEMENT_CAVEAT =
  "This checks that an element treeline observed during the crawl is still present — the page may have changed since capture; review before removing test.skip.";

interface BaseInterpretation {
  pageType: string;
  purpose: string;
  keyDataEntities: string[];
  confidence: number;
}

export async function interpretPage(
  pageState: PageState,
): Promise<PageInterpretation> {
  const routingDecision = decideTier(pageState);
  const model = routingDecision.tier === "haiku" ? HAIKU_MODEL : SONNET_MODEL;
  const client = getAnthropicClient();
  const base = await runBaseInterpretation(pageState, client, model);
  const proposedAssertion =
    pageState.forms.length > 0
      ? await proposeAssertion(pageState, pageState.forms[0]!, client, model)
      : await proposeContentAssertion(pageState, base, client, model);
  return {
    url: pageState.url,
    tierUsed: routingDecision.tier,
    pageType: base.pageType,
    purpose: base.purpose,
    keyDataEntities: base.keyDataEntities,
    confidence: base.confidence,
    proposedAssertion,
  };
}

async function runBaseInterpretation(
  pageState: PageState,
  client: Anthropic,
  model: string,
): Promise<BaseInterpretation> {
  for (let attempt = 1; attempt <= MAX_INTERPRETATION_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      tools: [
        {
          name: "interpret_page",
          description:
            "Interpret a web page from its aria snapshot. keyDataEntities must be an array of distinct entity name strings, never a single comma-separated string. Each entry names an entity type the page displays, never an individual instance of one.",
          input_schema: {
            type: "object",
            properties: {
              pageType: { type: "string" },
              purpose: { type: "string" },
              keyDataEntities: {
                type: "array",
                items: { type: "string" },
                description:
                  "An array of distinct entity name strings, never a single comma-separated string. Each entry is an entity type, never an individual instance: if the page shows a repeating list of similar items, name the entity type once plus its fields (for a story list: 'story title', 'points', 'submission time'), never one entry per item — never enumerate the items themselves.",
              },
              confidence: { type: "number" },
            },
            required: ["pageType", "purpose", "keyDataEntities", "confidence"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "interpret_page" },
      messages: [
        {
          role: "user",
          content: `URL: ${pageState.url}\nTitle: ${pageState.title}\n\nAria Snapshot:\n${pageState.ariaSnapshot}`,
        },
      ],
    });
    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use",
    );
    const attemptsRemain = attempt < MAX_INTERPRETATION_ATTEMPTS;
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      if (attemptsRemain) {
        console.warn(
          `interpret_page tool_use block missing, retrying (attempt ${attempt + 1}/${MAX_INTERPRETATION_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      throw new Error(
        `interpret_page tool_use block missing from API response for URL: ${pageState.url}`,
      );
    }
    const input = toolUseBlock.input as Record<string, unknown>;
    const isValidPageType =
      typeof input.pageType === "string" && input.pageType.trim().length > 0;
    const isValidPurpose =
      typeof input.purpose === "string" && input.purpose.trim().length > 0;
    const isValidKeyDataEntities =
      Array.isArray(input.keyDataEntities) &&
      input.keyDataEntities.every(
        (entity) => typeof entity === "string" && entity.length > 0,
      );
    const isValidConfidence =
      typeof input.confidence === "number" &&
      Number.isFinite(input.confidence) &&
      input.confidence >= 0 &&
      input.confidence <= 1;
    if (
      !isValidPageType ||
      !isValidPurpose ||
      !isValidKeyDataEntities ||
      !isValidConfidence
    ) {
      if (attemptsRemain) {
        console.warn(
          `interpret_page tool_use input has unexpected shape, retrying (attempt ${attempt + 1}/${MAX_INTERPRETATION_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.log(JSON.stringify(response, null, 2));
      throw new Error(
        `interpret_page tool_use input has unexpected shape for URL: ${pageState.url}`,
      );
    }
    let keyDataEntities = input.keyDataEntities as string[];
    if (keyDataEntities.length > MAX_KEY_DATA_ENTITIES) {
      console.warn(
        `interpret_page returned ${keyDataEntities.length} keyDataEntities for URL: ${pageState.url} — likely enumerating instances instead of entity types; capping to ${MAX_KEY_DATA_ENTITIES}`,
      );
      keyDataEntities = keyDataEntities.slice(0, MAX_KEY_DATA_ENTITIES);
    }
    return {
      pageType: input.pageType as string,
      purpose: input.purpose as string,
      keyDataEntities,
      confidence: input.confidence as number,
    };
  }
  throw new Error(
    `interpret_page failed after ${MAX_INTERPRETATION_ATTEMPTS} attempts for URL: ${pageState.url}`,
  );
}

function buildProposalPrompt(pageState: PageState, form: CapturedForm): string {
  const fieldsDescription = form.fields
    .map((field, index) => {
      if (field.role === "button") return null;
      const label = field.accessibleName || "(unlabeled)";
      const kind = field.inputType ?? field.tagName;
      return `[${index}] ${label} (role: ${field.role}, type: ${kind}${field.required ? ", required" : ""})`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
  return `URL: ${pageState.url}\nPage title: ${pageState.title}\n\nThis page has a form (action: ${form.action || "(none)"}, method: ${form.method}) with these fields, each labeled with its index in brackets:\n${fieldsDescription || "(no fillable fields found)"}\n\nPropose a single realistic test scenario for filling out and submitting this form, using obviously synthetic placeholder values only (e.g. "Test User", "test@example.com", "555-0100") — never anything that could pass for a real person's real data, and never anything you infer about this specific site from outside knowledge, even if you recognize the URL. If this form's primary or only meaningful field is a search or filter query, phrase the success assertion as an observable state change following submission — a results list becoming visible, an item count changing, or the URL reflecting the query — never a confirmation-message pattern, since search results pages don't have that pattern and you should not invent one. If this form has no meaningful fill-and-submit scenario at all, set applicable to false and leave the other fields empty. Otherwise set applicable to true and describe: a short scenario, a proposed value for each fillable field (referencing it by its bracketed index — do not invent a field or its label), and what would indicate the submission succeeded — phrased as an observation, not a guarantee, since you have never seen this form actually submitted.`;
}

async function proposeAssertion(
  pageState: PageState,
  form: CapturedForm,
  client: Anthropic,
  model: string,
): Promise<FormFillAssertion | null> {
  for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [
        {
          name: "propose_assertion",
          description:
            "Propose a test scenario for filling out and submitting a captured form, using only obviously synthetic placeholder data. Set applicable to false if this form has no meaningful fill-and-submit scenario.",
          input_schema: {
            type: "object",
            properties: {
              applicable: { type: "boolean" },
              scenario: { type: "string" },
              fieldValues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    fieldIndex: {
                      type: "integer",
                      description: "The bracketed index of the field this value is for, exactly as given in the field list.",
                    },
                    value: { type: "string" },
                  },
                  required: ["fieldIndex", "value"],
                },
              },
              successAssertion: { type: "string" },
            },
            required: ["applicable", "scenario", "fieldValues", "successAssertion"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "propose_assertion" },
      messages: [
        {
          role: "user",
          content: buildProposalPrompt(pageState, form),
        },
      ],
    });
    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use",
    );
    const attemptsRemain = attempt < MAX_PROPOSAL_ATTEMPTS;
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      if (attemptsRemain) {
        console.warn(
          `propose_assertion tool_use block missing, retrying (attempt ${attempt + 1}/${MAX_PROPOSAL_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.warn(
        `propose_assertion tool_use block missing from API response for URL: ${pageState.url} — skipping proposed assertion`,
      );
      return null;
    }
    const input = toolUseBlock.input as Record<string, unknown>;
    if (typeof input.applicable !== "boolean") {
      if (attemptsRemain) {
        console.warn(
          `propose_assertion tool_use input has unexpected shape, retrying (attempt ${attempt + 1}/${MAX_PROPOSAL_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.warn(
        `propose_assertion tool_use input has unexpected shape for URL: ${pageState.url} — skipping proposed assertion`,
      );
      return null;
    }
    if (!input.applicable) return null;
    const isValidScenario =
      typeof input.scenario === "string" && input.scenario.trim().length > 0;
    const isValidFieldValues =
      Array.isArray(input.fieldValues) &&
      input.fieldValues.every(
        (fv): fv is { fieldIndex: number; value: string } =>
          typeof fv === "object" &&
          fv !== null &&
          typeof (fv as Record<string, unknown>).fieldIndex === "number" &&
          Number.isInteger((fv as Record<string, unknown>).fieldIndex) &&
          typeof (fv as Record<string, unknown>).value === "string",
      );
    const isValidSuccessAssertion =
      typeof input.successAssertion === "string" &&
      input.successAssertion.trim().length > 0;
    if (!isValidScenario || !isValidFieldValues || !isValidSuccessAssertion) {
      if (attemptsRemain) {
        console.warn(
          `propose_assertion tool_use input has unexpected shape, retrying (attempt ${attempt + 1}/${MAX_PROPOSAL_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.warn(
        `propose_assertion tool_use input has unexpected shape for URL: ${pageState.url} — skipping proposed assertion`,
      );
      return null;
    }
    const fieldValues = (input.fieldValues as { fieldIndex: number; value: string }[])
      .filter((fv) => fv.fieldIndex >= 0 && fv.fieldIndex < form.fields.length && form.fields[fv.fieldIndex]!.role !== "button")
      .map((fv) => ({
        fieldIndex: fv.fieldIndex,
        accessibleName: form.fields[fv.fieldIndex]!.accessibleName,
        value: fv.value,
      }));
    return {
      kind: "form-fill",
      scenario: input.scenario as string,
      formIndex: form.formIndex,
      fieldValues,
      successAssertion: input.successAssertion as string,
      successAssertionCaveat: UNVERIFIED_GUESS_CAVEAT,
    };
  }
  return null;
}

function buildContentProposalPrompt(pageState: PageState, base: BaseInterpretation): string {
  const elementsDescription = pageState.interactiveElements
    .map((element, index) => {
      const label = element.accessibleName || "(unlabeled)";
      return `[${index}] ${label} (role: ${element.role})`;
    })
    .join("\n");
  return `URL: ${pageState.url}\nPage title: ${pageState.title}\nPage type: ${base.pageType}\nPurpose: ${base.purpose}\nKey data entities: ${base.keyDataEntities.join(", ") || "(none)"}\n\nThis page has no forms. These are the interactive elements treeline actually captured during the crawl, each labeled with its index in brackets:\n${elementsDescription || "(no interactive elements found)"}\n\nIdentify 1-3 of these already-captured elements that most directly evidence this page fulfilling its stated purpose (for example: a heading or link naming the key content, a button central to the page's function). Reference them only by their bracketed index — do not invent an element or its label, and do not describe body text that is not in this list. If nothing on the page meaningfully supports an assertion like this (for example: no interactive elements were captured, or the only elements are generic navigation chrome unrelated to the page's purpose), set applicable to false and leave the other fields empty. Otherwise set applicable to true and describe: a short scenario naming what this checks, the bracketed indices of the elements that evidence it, and an assertion statement describing what the presence of these elements demonstrates about the page.`;
}

async function proposeContentAssertion(
  pageState: PageState,
  base: BaseInterpretation,
  client: Anthropic,
  model: string,
): Promise<ContentPresenceAssertion | null> {
  for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [
        {
          name: "propose_content_assertion",
          description:
            "Propose a content-presence assertion referencing already-captured interactive elements on a form-less page. Set applicable to false if nothing on the page meaningfully supports one.",
          input_schema: {
            type: "object",
            properties: {
              applicable: { type: "boolean" },
              scenario: { type: "string" },
              elementIndices: {
                type: "array",
                items: {
                  type: "integer",
                  description: "The bracketed index of a captured interactive element, exactly as given in the element list.",
                },
              },
              assertion: { type: "string" },
            },
            required: ["applicable", "scenario", "elementIndices", "assertion"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "propose_content_assertion" },
      messages: [
        {
          role: "user",
          content: buildContentProposalPrompt(pageState, base),
        },
      ],
    });
    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use",
    );
    const attemptsRemain = attempt < MAX_PROPOSAL_ATTEMPTS;
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      if (attemptsRemain) {
        console.warn(
          `propose_content_assertion tool_use block missing, retrying (attempt ${attempt + 1}/${MAX_PROPOSAL_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.warn(
        `propose_content_assertion tool_use block missing from API response for URL: ${pageState.url} — skipping proposed assertion`,
      );
      return null;
    }
    const input = toolUseBlock.input as Record<string, unknown>;
    if (typeof input.applicable !== "boolean") {
      if (attemptsRemain) {
        console.warn(
          `propose_content_assertion tool_use input has unexpected shape, retrying (attempt ${attempt + 1}/${MAX_PROPOSAL_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.warn(
        `propose_content_assertion tool_use input has unexpected shape for URL: ${pageState.url} — skipping proposed assertion`,
      );
      return null;
    }
    if (!input.applicable) return null;
    const isValidScenario =
      typeof input.scenario === "string" && input.scenario.trim().length > 0;
    const isValidElementIndices =
      Array.isArray(input.elementIndices) &&
      input.elementIndices.every(
        (i) => typeof i === "number" && Number.isInteger(i),
      );
    const isValidAssertion =
      typeof input.assertion === "string" && input.assertion.trim().length > 0;
    if (!isValidScenario || !isValidElementIndices || !isValidAssertion) {
      if (attemptsRemain) {
        console.warn(
          `propose_content_assertion tool_use input has unexpected shape, retrying (attempt ${attempt + 1}/${MAX_PROPOSAL_ATTEMPTS}) for URL: ${pageState.url}`,
        );
        continue;
      }
      console.warn(
        `propose_content_assertion tool_use input has unexpected shape for URL: ${pageState.url} — skipping proposed assertion`,
      );
      return null;
    }
    const elementIndices = (input.elementIndices as number[]).filter(
      (i) => i >= 0 && i < pageState.interactiveElements.length,
    );
    if (elementIndices.length === 0) return null;
    return {
      kind: "content-presence",
      scenario: input.scenario as string,
      elementIndices,
      assertion: input.assertion as string,
      assertionCaveat: OBSERVED_ELEMENT_CAVEAT,
    };
  }
  return null;
}
