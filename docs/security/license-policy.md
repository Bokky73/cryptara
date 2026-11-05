# Dependency license policy

Cryptara records a license disposition for every component in the generated CycloneDX inventories. A missing lockfile license is emitted as `NOASSERTION`; it is never silently treated as permissive.

## Dispositions

- **Allowed:** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, BlueOak-1.0.0, MPL-2.0, Python-2.0, Unicode-3.0 and Unlicense, including SPDX `AND`/`OR` combinations composed only of these identifiers.
- **Review required:** copyleft licenses, `SEE LICENSE IN …`, custom expressions and `NOASSERTION`. CI reports these packages in its license review summary. A release owner must inspect distribution obligations before shipping them.
- **Denied:** a package whose license is explicitly marked `UNLICENSED`, `NONE`, or `PROPRIETARY`, unless a time-bounded exception in `dependency-exceptions.json` identifies the impact, rationale, compensating control, owner and approver.

The policy check validates that each resolved npm component receives exactly one of these dispositions. Newly encountered expressions cannot disappear into an implicit default: they are reported as review-required. The SBOM preserves the original expression so legal and security review can be repeated without reinstalling dependencies.

## Exceptions

Use advisory value `license:<expression>` for a license exception. Exceptions expire on the declared ISO date and are rejected when any required governance field is blank. Approval documents a temporary risk decision; it does not relicense the dependency.

## Review procedure

1. Confirm whether the dependency is production, development-only, optional, or unreachable in the shipped artifact.
2. Read the license file from the exact locked package version; do not rely only on registry search results.
3. Record attribution, source-offer, notice, linking, modification, and redistribution obligations.
4. Replace the dependency when obligations conflict with the product’s distribution model.
5. Regenerate all three SBOMs and retain the CI artifact with the release evidence.
