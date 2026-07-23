import ts from 'typescript'

export class GeneratedArtifactSyntaxError extends Error {
  readonly fileName: string
  readonly diagnostics: string[]
  constructor(fileName: string, diagnostics: string[]) {
    super(
      `[treeline] generated artifact "${fileName}" failed the TypeScript syntax gate — a generated artifact that does not parse is a treeline bug, never valid output:\n${diagnostics.map((d) => `  ${d}`).join('\n')}`,
    )
    this.name = 'GeneratedArtifactSyntaxError'
    this.fileName = fileName
    this.diagnostics = diagnostics
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    return `line ${line + 1}, column ${character + 1}: ${message}`
  }
  return message
}

export function collectSyntaxDiagnostics(fileName: string, code: string): string[] {
  const result = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
  })
  return (result.diagnostics ?? []).map(formatDiagnostic)
}

export function assertGeneratedArtifactParses(fileName: string, code: string): void {
  const diagnostics = collectSyntaxDiagnostics(fileName, code)
  if (diagnostics.length > 0) throw new GeneratedArtifactSyntaxError(fileName, diagnostics)
}
