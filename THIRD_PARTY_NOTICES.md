# Third-party notices

The [MIT license](LICENSE) applies to Flowrish’s original code and documentation. It does not replace third-party licenses. `package-lock.json` records package versions and declared licenses; each installed package’s license and notices remain authoritative.

The project uses Next.js and React, Supabase clients, Prisma, Tailwind CSS, shadcn/ui, Lucide, Tiptap, TanStack Query, Zustand, Flowgram, and other packages listed in `package.json`. Most dependencies use MIT, Apache 2.0, BSD, or ISC licenses.

## Distribution review

The current dependency tree also includes obligations that need attention when distributing built artifacts:

- Sharp’s optional libvips native binaries use LGPL-3.0-or-later; platform bundles may carry additional Apache and MIT notices. Retain the supplied license files and review the distribution requirements when shipping binaries or containers.
- Some transitive packages use MPL-2.0, Python-2.0, Unicode-DFS-2016, CC-BY-4.0, or other licenses. Preserve the applicable notices and attribution. Modified covered files may have additional source-distribution requirements.
- JSZip offers an MIT or GPL choice. Its MIT option is available; do not remove its notice.
- Generated bundles may contain dependency code even when `node_modules` is excluded from the repository. A source-only license file is not a substitute for reviewing a binary or container distribution.

Provider names, logos, and trademarks belong to their respective owners. Source availability does not grant trademark rights, API credits, service accounts, hosted access, or rights to customer data.

## shadcn/ui

The UI components are based on shadcn/ui, used under the MIT license:

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
