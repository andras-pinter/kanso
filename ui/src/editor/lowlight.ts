import { createLowlight } from 'lowlight';
import rust from 'highlight.js/lib/languages/rust';
import ts from 'highlight.js/lib/languages/typescript';
import js from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import md from 'highlight.js/lib/languages/markdown';
import toml from 'highlight.js/lib/languages/ini';
import yaml from 'highlight.js/lib/languages/yaml';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';

/**
 * Curated language set. Anything not registered here falls back to plain
 * text — highlight.js's `auto` mode is a bundle-size trap so we skip it.
 */
export const lowlight = createLowlight({
  rust,
  ts,
  typescript: ts,
  js,
  javascript: js,
  json,
  bash,
  sh: bash,
  shell: bash,
  sql,
  md,
  markdown: md,
  toml,
  yaml,
  yml: yaml,
  python,
  py: python,
  css,
  html: xml,
  xml,
});
