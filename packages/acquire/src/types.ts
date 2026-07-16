export interface NetworkEntry {
  url: string
  method: string
  status: number
  resourceType: string
  durationMs: number
  responseBodySample: string | null
}

export interface DomInteractiveElement {
  role: string
  accessibleName: string
  testId: string | null
  tagName: string
  elementId: string | null
  classList: string[]
  cssPath: string
  xpath: string
  appearedAtMs: number | null
}

export interface ColorSwatch {
  hex: string
  property: 'color' | 'background-color'
  usageCount: number
  exampleSelector: string
}

export interface AxeViolationNode {
  target: string[]
  html: string
  failureSummary: string | null
}

export interface AxeViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
  description: string
  help: string
  helpUrl: string
  nodes: AxeViolationNode[]
}

export interface AxeIncompleteResult {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
  description: string
  help: string
  helpUrl: string
  nodes: AxeViolationNode[]
}

export interface CapturedFormField {
  role: string
  accessibleName: string
  tagName: string
  inputType: string | null
  required: boolean
  pattern: string | null
  testId: string | null
  cssPath: string
}

export interface CapturedForm {
  formIndex: number
  action: string
  method: string
  fields: CapturedFormField[]
}

export interface PageState {
  url: string
  title: string
  ariaSnapshot: string
  links: string[]
  networkLog: NetworkEntry[]
  screenshot: Buffer | null
  capturedAt: string
  pageLoadMs: number
  interactiveElements: DomInteractiveElement[]
  axeViolations: AxeViolation[]
  axeIncomplete: AxeIncompleteResult[]
  forms: CapturedForm[]
  colorPalette: ColorSwatch[]
}

export interface AcquireOptions {
  stealth?: boolean
  proxy?: string
  captureResponseBodies?: boolean
  maxResponseBodyBytes?: number
  sampledEndpoints?: Set<string>
}

export interface CaptureHandler {
  matches(url: string, ariaSnapshot: string): Promise<boolean>
  capture(url: string, options?: AcquireOptions): Promise<PageState>
}
