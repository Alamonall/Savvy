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
