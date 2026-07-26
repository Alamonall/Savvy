# Правила коммитов и Pull Request

## Conventional Commits

Каждый коммит обязан соответствовать формату, а весь текст commit message должен быть на английском языке:

```text
type(scope): description
```

Допустимые типы:

- `feat` — новая функциональность;
- `fix` — исправление ошибки;
- `refactor` — изменение структуры без изменения поведения;
- `perf` — оптимизация производительности;
- `test` — тесты;
- `build` — сборка и зависимости;
- `ci` — CI/CD;
- `docs` — документация;
- `chore` — прочие технические изменения;
- `revert` — отмена предыдущего коммита.

Правила:

- описание после типа и `scope` пишется только на английском языке;
- subject и body commit message пишутся только на английском языке;
- описание начинается со строчной буквы и формулируется в повелительном наклонении;
- коммиты без Conventional Commits запрещены;
- один коммит должен содержать одно логически связанное изменение;
- breaking change отмечается `!` после типа или scope и дополнительно описывается в footer как `BREAKING CHANGE:`.

Примеры:

```text
feat(downloads): add task retry
fix: correct the application icon path
docs: update development rules
```

## Pull Request

Заголовок и описание каждого PR должны быть написаны только на английском языке и соответствовать формату Conventional Commits:

```text
type(scope): description
```

В PR запрещены заголовки без допустимого типа, например `Update`, `Changes`, `WIP` или произвольное описание.

PR обязан содержать:

- a short description of the change;
- the reason for the change;
- a list of completed checks;
- a description of breaking changes, if any.

Перед открытием PR необходимо проверить заголовок и все коммиты в ветке. Если коммиты не соответствуют Conventional Commits, их нужно исправить интерактивным rebase до создания PR.

## UI Consistency and Reuse

- Before adding new UI markup or styles, inspect existing components, render helpers, CSS classes, design tokens, and interaction handlers that provide the same behavior.
- Actively reuse existing components and shared render helpers for actions, statuses, progress indicators, tooltips, inputs, cards, and empty states. Do not create parallel implementations for visually or functionally equivalent elements.
- Equivalent UI elements must use the same DOM structure, class names, spacing, typography, colors, states, and interaction behavior across ordinary items, grouped items, dialogs, and settings.
- Represent legitimate visual or behavioral variants with shared components plus explicit modifier classes or data attributes. Avoid duplicating a component solely because it appears in another container.
- Keep shared styles in the common component selector or design token. Add a specialized selector only when the difference is intentional and documented by the component structure.
- When introducing a new component instead of reusing an existing one, explain the boundary in the code review and add focused tests for its states and interactions.
- Every UI change must be checked in both light and dark themes, including hover, focus, disabled, success, and error states where applicable.
