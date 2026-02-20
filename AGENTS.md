# Project Agent Instructions

## Core workflow
- After any code change, run the test suite (`pnpm test`) before considering the task complete.
- If you add or change functionality, add or update tests where appropriate (unit and/or integration).
- Focus tests on brittle logic, parsing, pipeline behavior, and output data integrity.

## Testing scope
- HTML report output does **not** require automated testing.
- Do not spend test effort on DOM structure or visual report rendering unless explicitly requested.
