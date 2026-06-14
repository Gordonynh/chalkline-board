declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: {
      includeDefaultStyleMap?: boolean
      includeEmbeddedStyleMap?: boolean
      ignoreEmptyParagraphs?: boolean
      styleMap?: string[]
    },
  ): Promise<{ value: string; messages: unknown[] }>
}
