export interface NetworkEntry {
  url: string
  method: string
  status: number
  resourceType: string
}

export interface PageState {
  url: string
  title: string
  ariaSnapshot: string
  links: string[]
  networkLog: NetworkEntry[]
  screenshot: string | null
  capturedAt: string
}

export interface AcquireOptions {
  stealth?: boolean
  proxy?: string
}

export interface CaptureHandler {
  matches(url: string, ariaSnapshot: string): Promise<boolean>
  capture(url: string, options?: AcquireOptions): Promise<PageState>
}
