# Harness 0.2.12 dependency audit

Reviewed on 2026-10-18 for this plugin workspace. The official npm registry
reported 15 affected package nodes, not 15 independent vulnerabilities.
After the changes below, `npm audit --registry=https://registry.npmjs.org`
reports zero known vulnerabilities for this workspace's resolved dependency tree.
This is a registry audit result, not proof that every deployment is secure.

## Current host dependency and metadata contract

`engines.nomix` is exactly `0.2.12`, the only verified and supported Harness version. The root package and all eight private workspaces declare `@nomix-ai/nomix-harness` in both `peerDependencies` and `devDependencies`, each exactly `0.2.12`, with no regular runtime Harness dependency. Host dependencies still require assessment in the consuming application's actual tree.

Display metadata exports cover the root (`./locale/*.json`, `./icon`) and each of `./plugin`, `./gateway-provider`, `./business-identity` and `./service` (`/locale/*.json`, `/icon`). Each entry has its own English and Chinese title and description; every icon export shares the original `resources/icon.svg`, with no external artwork or added dependency.

The standards update has not been verified by a build, package archive or live Harness installation; rendered metadata and icons remain unverified. The audit and test results recorded elsewhere in this document are earlier evidence and were not rerun for this resource/documentation update.

## Findings and changes

| Affected nodes | Entry and trigger | Current plugin exposure | Resolution |
| --- | --- | --- | --- |
| `vitest`, `@vitest/mocker`, `tinypool` (3) | Exposed Vitest server/mock endpoints; Tinypool worker options combined with prototype pollution | Development dependencies. This workspace uses `vitest run`, not an exposed UI server. These are not plugin runtime dependencies. | Upgrade Vitest 3.2.4 to 4.1.11, which uses patched mocker and removes Tinypool from this lockfile. 3.2.7 still retains affected dependencies. |
| `fast-uri` (1) | URI authority serialization/parsing inconsistencies; dependency of AJV, also reachable through Harness's MCP dependencies | No direct use for Gateway target selection: plugin transport uses platform URL/fetch. AJV validates repository-owned OpenAPI in tests. Other host-loaded MCP components need independent assessment. | Update compatible lockfile resolution from 3.1.6 to 3.1.8. |
| `source-map-js` (1) | Malformed indexed source-map offsets can block the event loop; PostCSS/Vite dependency | Development dependency; no plugin runtime source-map ingestion. | Update compatible lockfile resolution to 1.2.2. |
| `fflate`, `@deepseek-ai/libreoffice-kit`, Harness, `nomix-office-to-pdf`, `nomix-skill-office`, `nomix-sdk-app`, `nomix-sdk-client`, `nomix-sdk-minimal`, `nomix-subagent-nomix-sdk`, `nomix-web-app` (10) | LibreOffice worker calls `unzipSync` on document bytes; malformed ZIP64 can loop indefinitely. The other nine nodes inherit this finding. | Plugin tools submit business fileResourceId values and do not invoke Office conversion or unzip document bytes. A host separately enabling Office conversion may expose this path. | Scoped root override changes LibreOffice's exact fflate 0.8.2 dependency to 0.8.3; Harness remains 0.2.12. |

Advisories:

- Vitest: [UI server](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [redirect mock](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
- Tinypool: [worker options](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).
- fast-uri: [port serialization](https://github.com/advisories/GHSA-qw65-cvwx-89v3), [bracket parsing](https://github.com/advisories/GHSA-58mr-gqgx-xq4g), [host normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
- source-map-js: [section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- fflate: [ZIP64 loop](https://github.com/advisories/GHSA-px8p-9vwx-vf98).

## Consumer installation boundary

The npm library's lockfile and overrides do not enforce the dependency tree of
an application installing it. npm only applies overrides from the application
root. In particular, LibreOffice kit 0.1.5 still declares exact `fflate: 0.8.2`.
Until the upstream dependency is updated, consumers that enable its Office
features should apply this override in their own root package.json and update
their lockfile, then verify their actual tree with npm audit:

```json
{
  "overrides": {
    "@deepseek-ai/libreoffice-kit": {
      "fflate": "0.8.3"
    }
  }
}
```

Existing consumer lockfiles must also resolve fast-uri >=3.1.8 and
source-map-js >=1.2.2 wherever these packages are present. Do not downgrade
Harness to 0.2.9 as suggested by npm's automatic fix calculation.

The scoped override can be removed after upstream declares a patched fflate
version and a fresh dependency resolution confirms no vulnerable copy remains.
No host or upstream repository was modified as part of this remediation.

## Verification boundary

169 plugin tests, TypeScript no-emit checks and lint passed with Vitest 4.1.11.
Installation used `--ignore-scripts`; no local build, package compilation or
native LibreOffice conversion was performed. Actual Office conversion behavior
and production host dependency trees remain outside this verification.
