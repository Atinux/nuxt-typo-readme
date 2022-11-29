import { getHighlighter, BUNDLED_LANGUAGES, BUNDLED_THEMES, Lang, Theme } from 'shiki-es'
import { visit } from 'unist-util-visit'
import type { HighlightParams, HighlightThemedToken, ParsedContent } from '@nuxt/content/dist/runtime/types'

/**
 * Resolve Shiki compatible lang from string.
 *
 * Used to resolve lang from both languages id's and aliases.
 */
const resolveLang = (lang: string): Lang | undefined =>
  BUNDLED_LANGUAGES.find(l => l.id === lang || l.aliases?.includes(lang))?.id as Lang

/**
 * Resolve Shiki compatible theme from string.
 */
const resolveTheme = (theme: string): Theme | undefined =>
  BUNDLED_THEMES.find(t => t === theme)

/**
 * Resolve Shiki highlighter compatible payload from request body.
 */
const resolveBody = (body: Partial<HighlightParams>): { code: string, lang?: Lang, theme?: Theme } => {
  return {
    // Remove trailing carriage returns
    code: body.code.replace(/\n+$/, ''),
    // Resolve lang & theme (i.e check if shiki supports them)
    lang: resolveLang(body.lang),
    theme: resolveTheme(body.theme)
  }
}

export const useShiki = async () => {
  // Grab highlighter config from publicRuntimeConfig
  const { syntaxHighlightTheme } = usePreferences()

  // Initialize highlighter with defaults
  const highlighter = await getHighlighter({
    theme: syntaxHighlightTheme.value || 'dark-plus',
    langs: [
      'json', 'js', 'ts', 'css', 'vue',
      'shell',
      'html',
      'md',
      'yaml',
      'diff'
    ] as any[]
  })

  async function highlightCode (params: Partial<HighlightParams>): Promise<HighlightThemedToken[][]> {
    const { code, lang, theme } = resolveBody(params)
    // Skip highlight if lang is not supported
    if (!lang) {
      return [[{ content: code }]]
    }

    // Load supported language on-demand
    if (!highlighter.getLoadedLanguages().includes(lang)) {
      await highlighter.loadLanguage(lang)
    }

    // Load supported theme on-demand
    if (theme && !highlighter.getLoadedThemes().includes(theme)) {
      await highlighter.loadTheme(theme)
    }

    // Highlight code
    return highlighter.codeToThemedTokens(code, lang, theme)
  }

  const tokenSpan = ({ content, color }) => ({
    type: 'element',
    tag: 'span',
    props: { style: { color } },
    children: [{ type: 'text', value: content }]
  })

  const highlightInline = async (node) => {
    const code = node.children[0].value

    // Fetch highlighted tokens
    const lines = await highlightCode({
      code,
      lang: node.props.lang || node.props.language
    })

    // Generate highlighted children
    node.children = lines[0].map(tokenSpan)

    node.props = node.props || {}
    node.props.class = 'colored'

    return node
  }

  const highlightBlock = async (node) => {
    const { code, language: lang, highlights = [] } = node.props

    // Fetch highlighted tokens
    const lines = await highlightCode({
      code,
      lang
    })

    // Generate highlighted children
    const innerCodeNode = node.children[0].children[0]
    innerCodeNode.children = lines.map((line, lineIndex) => ({
      type: 'element',
      tag: 'span',
      props: { class: ['line', highlights.includes(lineIndex + 1) ? 'highlight' : ''].join(' ').trim() },
      children: line.map(tokenSpan)
    }))
    return node
  }

  return async function highlight (content: ParsedContent) {
    const codeBlocks = []
    visit(
      content.body,
      (node: any) => node.tag === 'code' && node?.props.code,
      (node) => { codeBlocks.push(node) }
    )
    await Promise.all(codeBlocks.map(highlightBlock))

    const inlineCodes = []
    visit(
      content.body,
      (node: any) => node.tag === 'code-inline' && (node.props?.lang || node.props?.language),
      (node) => { inlineCodes.push(node) }
    )

    await Promise.all(inlineCodes.map(highlightInline))

    return content
  }
}
