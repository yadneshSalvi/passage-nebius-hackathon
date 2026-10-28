import { readFileSync } from "node:fs";
import { sha256 } from "./store.js";
/** Exact upstream notices retained with the two admitted public development cases. */
export function sourceNotices(repositoryUrl: string) {
  const known = {
    "https://github.com/tastejs/todomvc": { file: "todomvc-MIT.txt", source: "https://github.com/tastejs/todomvc/blob/ff43b02e59dfa604386bb382034b2cd07c2bcd8a/license.md" },
    "https://github.com/reactjs/react-modal": { file: "react-modal-MIT.txt", source: "https://github.com/reactjs/react-modal/blob/e66ab51b65e6c03d9dfa283f026da1c7f9f6c9b0/LICENSE" },
  }[repositoryUrl.replace(/\.git$/, "")];
  if (!known) return [];
  const content = readFileSync(new URL(`../docs/external-licenses/${known.file}`, import.meta.url), "utf8");
  return [{ name: known.file, content, sha256: sha256(content), sourceUrl: known.source, notice: "Attribution retained from the inspected upstream revision. This does not authenticate an arbitrary uploaded manifest's ancestry." }];
}
