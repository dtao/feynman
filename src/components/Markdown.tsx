import { memo, useMemo } from "react";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";

const marked = new Marked({ gfm: true, breaks: false });
marked.use(markedKatex({ throwOnError: false, output: "html", nonStandard: true }));

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false })), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});
