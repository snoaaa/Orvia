# Contributing to WAMDP

Thank you for contributing to the WAMDP project! To maintain high code quality, architectural consistency, and stability across the backend, web, and mobile subdomains, all contributors must adhere to the following branch rules and code review policies.

---

## 1. Branch Strategy

- **`main`**: The primary protected branch. Production-ready code only.
  - **Direct pushes are strictly disabled.**
  - **Force pushes and branch deletions are blocked.**
  - **All merges must happen via Pull Requests (PRs).**
- **Feature Branches**: All work must be conducted on dedicated branches cut from the latest `main`:
  - `feat/<feature-name>` for new features or endpoints
  - `fix/<bug-name>` for bug fixes and patches
  - `chore/<task-name>` for tooling, config, dependencies, or refactoring
  - `docs/<doc-name>` for documentation updates

---

## 2. Mandatory Code Reviewers & Code Owners

All pull requests targeting `main` must be reviewed and approved by the designated code owners:

| Reviewer | GitHub Handle | Role |
| :--- | :--- | :--- |
| **Abraham** | [@snoaaa](https://github.com/snoaaa) | Lead / Platform Admin |
| **Keli** | [@N2K-keli](https://github.com/N2K-keli) | Core Reviewer |

### Review & Merge Rules:
1. **Automatic Assignment**: GitHub automatically requests reviews from `@snoaaa` and `@N2K-keli` via `.github/CODEOWNERS` on every pull request.
2. **Approval Requirements**:
   - **PRs authored by team contributors**: Require approval from **both** `@snoaaa` and `@N2K-keli` (2 required approvals).
   - **PRs authored by `@snoaaa`**: Reviewed and approved by **`@N2K-keli`** (authors cannot approve their own PRs).
   - **PRs authored by `@N2K-keli`**: Reviewed and approved by **`@snoaaa`**.
3. **Code Owner Enforcement**: Code owner reviews are strictly required on `main`. Pull requests cannot bypass code owner sign-off.
4. **Conversation Resolution**: All review comments and discussions must be addressed and resolved prior to merging.

---

## 3. Pull Request Guidelines

Before submitting your PR:
1. **Sync with `main`**: Ensure your branch is rebased or up to date with `main` (`git pull origin main`).
2. **Run Tests & Linters**:
   - Backend (`api/`): Run unit and e2e tests (`npm run test`, `npm run test:e2e`).
   - Web (`web/`): Run linting and test suite (`npm run test`).
   - Mobile (`mobile/`): Validate TypeScript builds and linting.
3. **Database Changes**: If modifying Prisma schema (`schema.prisma`), include database migrations and make sure `npm run seed` runs without errors.
4. **PR Description**: Fill out the pull request template completely, explaining the problem solved and steps to test.
5. **Wait for Approvals**: Wait for `@snoaaa` and `@N2K-keli` to review and approve your PR before attempting to merge.
