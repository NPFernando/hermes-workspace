import type { LanguageInput } from 'shiki'

const SUPPORTED_LANGUAGES = new Set([
  'bash', 'c', 'cpp', 'css', 'diff', 'docker', 'go', 'html',
  'java', 'javascript', 'json', 'jsx', 'kotlin', 'markdown',
  'php', 'python', 'ruby', 'rust', 'sql', 'swift', 'toml',
  'tsx', 'typescript', 'xml', 'yaml', 'text',
])

// Explicit per-language dynamic imports so Rollup only bundles these 23 grammars
// instead of all 200+ bundled languages. Each language loads on first use.
export const LANG_LOADERS: Partial<Record<string, () => Promise<LanguageInput>>> = {
  bash:       () => import('shiki/langs/bash.mjs').then((m) => m.default as LanguageInput),
  c:          () => import('shiki/langs/c.mjs').then((m) => m.default as LanguageInput),
  cpp:        () => import('shiki/langs/cpp.mjs').then((m) => m.default as LanguageInput),
  css:        () => import('shiki/langs/css.mjs').then((m) => m.default as LanguageInput),
  diff:       () => import('shiki/langs/diff.mjs').then((m) => m.default as LanguageInput),
  docker:     () => import('shiki/langs/docker.mjs').then((m) => m.default as LanguageInput),
  go:         () => import('shiki/langs/go.mjs').then((m) => m.default as LanguageInput),
  html:       () => import('shiki/langs/html.mjs').then((m) => m.default as LanguageInput),
  java:       () => import('shiki/langs/java.mjs').then((m) => m.default as LanguageInput),
  javascript: () => import('shiki/langs/javascript.mjs').then((m) => m.default as LanguageInput),
  json:       () => import('shiki/langs/json.mjs').then((m) => m.default as LanguageInput),
  jsx:        () => import('shiki/langs/jsx.mjs').then((m) => m.default as LanguageInput),
  kotlin:     () => import('shiki/langs/kotlin.mjs').then((m) => m.default as LanguageInput),
  markdown:   () => import('shiki/langs/markdown.mjs').then((m) => m.default as LanguageInput),
  php:        () => import('shiki/langs/php.mjs').then((m) => m.default as LanguageInput),
  python:     () => import('shiki/langs/python.mjs').then((m) => m.default as LanguageInput),
  ruby:       () => import('shiki/langs/ruby.mjs').then((m) => m.default as LanguageInput),
  rust:       () => import('shiki/langs/rust.mjs').then((m) => m.default as LanguageInput),
  sql:        () => import('shiki/langs/sql.mjs').then((m) => m.default as LanguageInput),
  swift:      () => import('shiki/langs/swift.mjs').then((m) => m.default as LanguageInput),
  toml:       () => import('shiki/langs/toml.mjs').then((m) => m.default as LanguageInput),
  tsx:        () => import('shiki/langs/tsx.mjs').then((m) => m.default as LanguageInput),
  typescript: () => import('shiki/langs/typescript.mjs').then((m) => m.default as LanguageInput),
  xml:        () => import('shiki/langs/xml.mjs').then((m) => m.default as LanguageInput),
  yaml:       () => import('shiki/langs/yaml.mjs').then((m) => m.default as LanguageInput),
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  react: 'jsx',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  txt: 'text',
}

export function normalizeLanguage(language: string): string {
  const cleaned = language
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^\[|\]$/g, '')
  const token = cleaned.split(/[\s,]+/)[0] || 'text'
  return LANGUAGE_ALIASES[token] ?? token
}

export function resolveLanguage(language: string): string {
  const normalized = normalizeLanguage(language)
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : 'text'
}

export function formatLanguageName(language: string): string {
  const names: Record<string, string> = {
    bash: 'Bash',
    python: 'Python',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    tsx: 'TSX',
    jsx: 'JSX',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    sql: 'SQL',
    yaml: 'YAML',
    markdown: 'Markdown',
    text: 'Plain Text',
  }
  return names[language] || language.charAt(0).toUpperCase() + language.slice(1)
}
