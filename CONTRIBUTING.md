# Contributing to WAMDP

Thank you for contributing to the WAMDP project! To maintain high code quality, architectural consistency, and stability across the backend, web, and mobile subdomains, all contributors must adhere to the following branch rules and code review policies.

---

## 1. Branch Strategy

WAMDP follows a staged GitFlow branching model:

- **`develop`**: The primary **integration branch** (our second main).
  - **All active development, feature, bugfix, and chore PRs must target `develop`.**
  - **Direct pushes are strictly disabled.**
  - **Force pushes and branch deletions are blocked.**
  - **All merges must happen via Pull Requests (PRs)** with required approvals.
  - Acts as the pre-release/staging baseline where all newly merged work is tested together.
- **`main`**: The **production branch** (default repository branch for cloning).
  - Contains strictly stable, release-ready code deployed to production.
  - **Direct pushes are strictly disabled.**
  - Code is promoted from `develop` into `main` via scheduled Release / Promotion PRs or tagged releases.
  - Hotfixes for critical production bugs may be cut from `main` and merged back into both `main` and `develop`.
- **Feature Branches**: All individual work must be conducted on dedicated branches cut from the latest `develop`:
  - `feat/<feature-name>` for new features or endpoints
  - `fix/<bug-name>` for bug fixes and patches
  - `chore/<task-name>` for tooling, config, dependencies, or refactoring
  - `docs/<doc-name>` for documentation updates
  - `hotfix/<issue-name>` for critical production patches cut from `main`

---

## 2. Mandatory Code Reviewers & Code Owners

All pull requests targeting `develop` or `main` must be reviewed and approved by the designated code owners:

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
3. **Code Owner Enforcement**: Code owner reviews are strictly required on both `develop` and `main`. Pull requests cannot bypass code owner sign-off.
4. **Conversation Resolution**: All review comments and discussions must be addressed and resolved prior to merging.

---

## 3. Pull Request Guidelines

Before submitting your PR:
1. **Target Base Branch**: **All pull requests must target `develop`.** Because `main` is the default repository branch, GitHub pre-selects `main` in the base branch dropdown; you **must manually switch the base branch to `develop`** when opening a pull request. Do not open feature or bugfix PRs directly against `main`.
2. **Sync with `develop`**: Ensure your branch is rebased or up to date with `develop` (`git pull origin develop`).
3. **Run Tests & Linters**:
   - Backend (`api/`): Run unit and e2e tests (`npm run test`, `npm run test:e2e`).
   - Web (`web/`): Run linting and test suite (`npm run test`).
   - Mobile (`mobile/`): Validate TypeScript builds and linting.
4. **Database Changes**: If modifying Prisma schema (`schema.prisma`), include database migrations and make sure `npm run seed` runs without errors.
5. **PR Description**: Fill out the pull request template completely, explaining the problem solved and steps to test.
6. **Wait for Approvals**: Wait for `@snoaaa` and `@N2K-keli` to review and approve your PR before attempting to merge.
