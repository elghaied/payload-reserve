# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## Adding a changeset

When you make a change that should be noted in the changelog, run:

```bash
pnpm changeset
```

This will prompt you for:
1. The semver bump type (major/minor/patch)
2. A summary of the change

The changeset file is committed with your PR.

## Releasing

1. Run `pnpm changeset:version` to consume all changesets, bump the version, and update CHANGELOG.md
2. Commit the version bump
3. Tag with `git tag v<version>` and push the tag
4. The GitHub Action will create a release with the changelog content and publish to npm
