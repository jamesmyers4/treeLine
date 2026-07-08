import type { PageState } from "@treeline/acquire";
import type { PageInterpretation } from "./types.js";
import { decideTier } from "./routing.js";
import { getAnthropicClient } from "./client.js";
import { HAIKU_MODEL, SONNET_MODEL } from "./models.js";

export async function interpretPage(
  pageState: PageState,
): Promise<PageInterpretation> {
  const routingDecision = decideTier(pageState);
  const model = routingDecision.tier === "haiku" ? HAIKU_MODEL : SONNET_MODEL;
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    tools: [
      {
        name: "interpret_page",
        description:
          "Interpret a web page from its aria snapshot. keyDataEntities must be an array of distinct entity name strings, never a single comma-separated string.",
        input_schema: {
          type: "object",
          properties: {
            pageType: { type: "string" },
            purpose: { type: "string" },
            keyDataEntities: {
              type: "array",
              items: { type: "string" },
              description:
                "An array of distinct entity name strings, never a single comma-separated string.",
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
  if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
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
    console.log(JSON.stringify(response, null, 2));
    throw new Error(
      `interpret_page tool_use input has unexpected shape for URL: ${pageState.url}`,
    );
  }
  return {
    url: pageState.url,
    tierUsed: routingDecision.tier,
    pageType: input.pageType as string,
    purpose: input.purpose as string,
    keyDataEntities: input.keyDataEntities as string[],
    confidence: input.confidence as number,
  };
}
