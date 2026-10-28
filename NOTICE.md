# Assets and dependencies

The Passage name treatment, path motif, fixture illustrations, application layouts, fixtures, and synthetic appointment data were authored for this project. Fictional service names do not imply real partnerships or patient/customer data.

The UI self-hosts the Latin subsets of Source Sans 3, Source Serif 4, and IBM Plex Mono from their pinned Fontsource packages. The fonts use the SIL Open Font License 1.1; license copies ship in `public/licenses/` and the installed packages. Source Sans and Source Serif originate with Adobe; IBM Plex originates with IBM. Lucide icons are supplied by `lucide-react` under ISC. Dependency versions and transitive licenses are recorded in `package-lock.json` and the packages' license files.

The application calls NVIDIA Nemotron only in explicitly enabled live mode: Nebius for submission, or explicitly selected Fireworks/Together development routes. Model weights are not bundled, downloaded, or redistributed. Provider access remains subject to the account holder's applicable provider and model terms. Offline reference repairs are handwritten project fixtures and are never labeled NVIDIA output.

Primary interaction references are the [W3C WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) and [W3C accessibility evaluation guidance](https://www.w3.org/WAI/test-evaluate/). The project does not claim W3C endorsement or certification.

The new external development cases use independently maintained public source: TodoMVC React at `ff43b02e59dfa604386bb382034b2cd07c2bcd8a` and react-modal Forms at `e66ab51b65e6c03d9dfa283f026da1c7f9f6c9b0`. Their exact upstream MIT notices are retained in `docs/external-licenses/` and accompany exported source guards. Public-source use is not maintainer participation, permission to represent the projects, or evidence of upstream adoption. The react-modal example uses a separately disclosed protected mount adapter; it is not a repair of the entire library.
