export interface NetworkEntry {
  url: string
  method: string
  status: number
  resourceType: string
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

export interface PageState {
  url: string
  title: string
  ariaSnapshot: string
  links: string[]
  networkLog: NetworkEntry[]
  screenshot: string | null
  capturedAt: string
  interactiveElements: DomInteractiveElement[]
  axeViolations: AxeViolation[]
  axeIncomplete: AxeIncompleteResult[]
}

export interface AcquireOptions {
  stealth?: boolean
  proxy?: string
}

export interface CaptureHandler {
  matches(url: string, ariaSnapshot: string): Promise<boolean>
  capture(url: string, options?: AcquireOptions): Promise<PageState>
}
