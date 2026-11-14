import { useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react'
import type { TodoDto } from '@shared/contracts'
import type { ReorderDirection, TodosState } from '../../state/use-todos'
import { formatDateTime } from '../../format-date'
import { t } from '../../translation'

type TodoPanelProps = {
  readonly state: TodosState
}

export function TodoPanel(props: TodoPanelProps) {
  const { state } = props
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const doneCount = state.todos.filter((todo) => todo.completed).length

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.target.value)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submitDraft()
  }

  function handleToggleChange(event: ChangeEvent<HTMLInputElement>): void {
    void state.toggleTodo(Number(event.currentTarget.dataset.todoId))
  }

  function handleMoveUpClick(event: MouseEvent<HTMLButtonElement>): void {
    void moveTodo(event, 'up')
  }

  function handleMoveDownClick(event: MouseEvent<HTMLButtonElement>): void {
    void moveTodo(event, 'down')
  }

  function handleArchiveClick(event: MouseEvent<HTMLButtonElement>): void {
    void archiveTodoById(Number(event.currentTarget.dataset.todoId))
  }

  function handleRestoreClick(event: MouseEvent<HTMLButtonElement>): void {
    void restoreTodoById(Number(event.currentTarget.dataset.todoId))
  }

  function handleEditClick(event: MouseEvent<HTMLButtonElement>): void {
    const todoId = Number(event.currentTarget.dataset.todoId)
    const todo = [...state.todos, ...state.archivedTodos].find((item) => item.id === todoId)
    if (todo === undefined) {
      return
    }
    setEditingId(todo.id)
    setEditDraft(todo.title)
    setMessage(null)
  }

  function handleEditDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    setEditDraft(event.target.value)
  }

  function handleSaveEdit(event: MouseEvent<HTMLButtonElement>): void {
    void saveEdit(Number(event.currentTarget.dataset.todoId))
  }

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>): void {
    void deleteById(Number(event.currentTarget.dataset.todoId))
  }

  function handleToggleArchivedView(): void {
    setShowArchived((current) => !current)
    setEditingId(null)
    setMessage(null)
  }

  async function submitDraft(): Promise<void> {
    const error = await state.createTodo(draft)
    if (error !== null) {
      setMessage(error)
      return
    }
    setDraft('')
    setMessage(null)
  }

  async function moveTodo(event: MouseEvent<HTMLButtonElement>, direction: ReorderDirection): Promise<void> {
    const error = await state.reorderTodo(Number(event.currentTarget.dataset.todoId), direction)
    setMessage(error)
  }

  async function archiveTodoById(todoId: number): Promise<void> {
    const error = await state.archiveTodo(todoId)
    setMessage(error)
  }

  async function restoreTodoById(todoId: number): Promise<void> {
    const error = await state.restoreTodo(todoId)
    setMessage(error)
  }

  async function saveEdit(todoId: number): Promise<void> {
    const error = await state.updateTodo(todoId, editDraft)
    if (error !== null) {
      setMessage(error)
      return
    }
    setEditingId(null)
    setMessage(null)
  }

  async function deleteById(todoId: number): Promise<void> {
    const todo = [...state.todos, ...state.archivedTodos].find((item) => item.id === todoId)
    if (todo === undefined) {
      return
    }
    if (!window.confirm(t('todos.confirmDelete', { title: todo.title }))) {
      return
    }
    const error = await state.removeTodo(todoId)
    if (error !== null) {
      setMessage(error)
      return
    }
    setEditingId(null)
    setMessage(null)
  }

  function renderEditing(todo: TodoDto) {
    return (
      <li key={todo.id} className="todo-item todo-item-editing">
        <input
          className="todo-edit-input"
          type="text"
          value={editDraft}
          aria-label={t('todos.titleAria')}
          onChange={handleEditDraftChange}
        />
        <button type="button" className="primary" data-todo-id={todo.id} onClick={handleSaveEdit}>
          {t('common.save')}
        </button>
        <button type="button" className="ghost" onClick={() => setEditingId(null)}>
          {t('common.cancel')}
        </button>
      </li>
    )
  }

  function renderTodoItem(todo: TodoDto) {
    if (todo.id === editingId) {
      return renderEditing(todo)
    }
    const itemClass = todo.completed ? 'todo-item is-done' : 'todo-item'
    return (
      <li key={todo.id} className={itemClass}>
        <input
          type="checkbox"
          className="todo-check"
          checked={todo.completed}
          data-todo-id={todo.id}
          onChange={handleToggleChange}
          aria-label={todo.completed ? t('todos.markUndone') : t('todos.markDone')}
        />
        <span className="todo-title" title={todo.title}>
          {todo.title}
        </span>
        <span className="todo-order">
          <button
            type="button"
            className="icon"
            data-todo-id={todo.id}
            onClick={handleMoveUpClick}
            aria-label={t('todos.moveUp')}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon"
            data-todo-id={todo.id}
            onClick={handleMoveDownClick}
            aria-label={t('todos.moveDown')}
          >
            ↓
          </button>
        </span>
        <button type="button" className="icon" data-todo-id={todo.id} onClick={handleEditClick}>
          {t('common.edit')}
        </button>
        <button
          type="button"
          className="icon"
          data-todo-id={todo.id}
          onClick={handleArchiveClick}
          aria-label={t('todos.archiveAria')}
        >
          {t('common.archive')}
        </button>
        <button type="button" className="icon icon-danger" data-todo-id={todo.id} onClick={handleDeleteClick}>
          {t('common.delete')}
        </button>
      </li>
    )
  }

  function renderArchivedItem(todo: TodoDto) {
    if (todo.id === editingId) {
      return renderEditing(todo)
    }
    return (
      <li key={todo.id} className="todo-item todo-item-archived">
        <span className={todo.completed ? 'todo-state is-done' : 'todo-state'}>
          {todo.completed ? t('todos.archivedDone') : t('todos.archivedUndone')}
        </span>
        <span className="todo-title" title={todo.title}>
          {todo.title}
        </span>
        <span className="todo-archived-at">{formatDateTime(todo.archivedAt)}</span>
        <button type="button" className="icon" data-todo-id={todo.id} onClick={handleEditClick}>
          {t('common.edit')}
        </button>
        <button
          type="button"
          className="icon"
          data-todo-id={todo.id}
          onClick={handleRestoreClick}
          aria-label={t('todos.restoreAria')}
        >
          {t('common.restore')}
        </button>
        <button type="button" className="icon icon-danger" data-todo-id={todo.id} onClick={handleDeleteClick}>
          {t('common.delete')}
        </button>
      </li>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('todos.title')}</h2>
        <div className="panel-head-actions">
          <span className="badge">{t('todos.progress', { done: doneCount, total: state.todos.length })}</span>
          <button type="button" className="ghost" onClick={handleToggleArchivedView}>
            {showArchived
              ? t('common.back')
              : t('todos.archiveCount', { count: state.archivedTodos.length })}
          </button>
        </div>
      </div>

      {showArchived ? (
        <ul className="todo-list">
          {state.archivedTodos.map(renderArchivedItem)}
          {state.archivedTodos.length === 0 ? <li className="empty">{t('todos.archivedEmpty')}</li> : null}
        </ul>
      ) : (
        <>
          <ul className="todo-list">
            {state.todos.map(renderTodoItem)}
            {state.todos.length === 0 ? <li className="empty">{t('todos.empty')}</li> : null}
          </ul>

          <form className="actions" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder={t('todos.placeholder')}
              value={draft}
              onChange={handleDraftChange}
            />
            <button type="submit" className="primary">
              {t('common.add')}
            </button>
          </form>
        </>
      )}

      {message === null ? null : <p className="message">{message}</p>}
    </section>
  )
}
