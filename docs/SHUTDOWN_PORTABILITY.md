# If this company stops

The likeliest long-run risk to a family's memories is not a breach. It is that
the company holding them quietly ceases to exist, and the archive turns out to
have been a subscription rather than a possession.

This document exists so that outcome is planned for rather than discovered.

## The commitment

**Everything is exportable at any time, without asking us for anything, in
formats that open without us.**

That is a design constraint, not a promise. It is why `export` is an inalienable
consent activity that the policy compiler refuses to remove, and why the export
format is a plain .zip rather than anything of ours.

## What is in an export

```
index.html                         The whole archive, browsable in any browser, offline
verify.mjs                         Re-checks every checksum and citation, no dependencies
README.txt                         Plain language: what this is, how it is laid out
manifest.json                      Every file with a SHA-256 checksum and byte size
manifest.sig                       Ed25519 signature over that manifest, when signed
metadata/archive.json              Name, subject, dates, what produced this
metadata/memories.json             Every story card with its status and dates
metadata/claims-and-evidence.json  Every claim, and the exact source passage behind it
metadata/transcripts.json          Machine transcripts and hand corrections, both
metadata/permissions.json          Who had access, in what capacity, when it changed
metadata/consent-history.json      Every consent version, hashed
metadata/sources.json              File metadata (storage keys deliberately removed)
originals/{sourceId}/{filename}    Every file exactly as it was uploaded
```

### Opening it, and checking it

Double-click `index.html`. It shows every story and, under each one, the exact
place in the recording it came from, with a button that plays that span of the
original file. It embeds its own data rather than fetching it, because a
browser opening a local file refuses to read the JSON beside it, and it loads
nothing from anywhere — no fonts, no scripts, no analytics.

To check the archive is intact:

```
node verify.mjs
```

It re-computes every checksum, refuses a file that was added after the export
was made, verifies the signature, and confirms that every citation still points
at a source and a place inside it that are present. It uses nothing but what
ships with Node, because the one artefact that has to keep working after we are
gone cannot depend on a package registry still being there.

**What the signature proves.** It covers every file, because the manifest lists
a checksum for each and the signature is over the manifest. It proves the export
came from us only if the fingerprint it prints matches one we published
somewhere you did not get from that folder — anybody who alters an archive can
re-sign it with a key of their own. The verifier says this out loud rather than
letting the word "signed" do more work than it can bear.

If no signing key was configured, the export says so plainly in every place it
could be asked: the manifest, the README, the export screen and the verifier's
output. The checksums still prove nothing was altered; they do not prove who
made it.

JSON and the original media. No proprietary container, no database dump, nothing
that needs EverEcho to read. Two photographs both called `scan.jpg` cannot
collide because each sits under its own source id.

The checksums are the part that matters in ten years: they let someone prove the
files have not been altered since the day the export was made.

## If we are winding down

In this order, and the order is the point:

1. **Tell every storyteller first**, with a date, and keep exports working
   until after it. Not the family — the storyteller. It is their archive.
2. **Remove the payment requirement** for exports immediately. Nobody should
   lose their mother's voice over a lapsed card.
3. **Publish the export format specification** — this document plus
   `metadata/*.json` shapes — so a third party can build a reader.
4. **Open-source the reader**, or at minimum a script that renders an export as
   static HTML. An archive nobody can open is not portable.
5. **Delete everything** on the stated date, and say so plainly. A company that
   winds down while keeping the data has not wound down.
6. **Publish what happened to the keys**, so a family knows whether an
   encrypted backup somewhere could still be read.

## What a family should do now, not later

- Export at least once, and keep the .zip somewhere they control.
- Check the checksums occasionally, or at least keep `manifest.json`.
- Know that the originals are the durable part. Story cards and answers can be
  rebuilt from them; the recordings cannot be rebuilt from anything.

## Deliberate design choices that serve this

- **Originals are never edited.** Every correction is a new row referencing the
  untouched source, so an export always contains what was actually recorded.
- **Claims carry locators**, not references into our schema — a page number, a
  timestamp, a character range. Meaningful to anyone with the original file.
- **Consent history is exported**, so a family can see what was agreed even if
  we are not around to be asked.
- **The zip writer is 60 lines of our own code** with no dependency. An export
  format that depends on a library that stops being maintained is not portable.
- **No proprietary embedding format is exported.** Embeddings are derived and
  rebuildable; shipping them would imply they matter more than the words.

## What is not solved

- **Identity.** An export contains no way to prove who the storyteller was, and
  it does not carry a signature. A family holding a .zip has the content but no
  cryptographic provenance beyond the checksums.
- **Continuity of access.** If a storyteller dies without exporting, the archive
  is subject to whatever succession arrangements exist — and v0.1 deliberately
  does not execute succession directives (see `docs/DECISION_LOG.md`, D-014 and
  the succession screen). Encouraging an export while the storyteller is alive is
  the honest answer for now.
