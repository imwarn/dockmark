/**
 * [INPUT]: depends on Category from @dockmark/core; useI18n from ./i18n
 * [OUTPUT]: exports BookmarkCategorySidebar component
 * [POS]: left sidebar of BookmarkManagerLegacy handling category CRUD/reordering and tag filter chips
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import type { DragEvent, FormEvent } from "react";
import type { Category } from "@dockmark/core";
import { useI18n } from "./i18n";

export interface TagCountItem {
  name: string;
  count: number;
}

interface Props {
  categories: Category[];
  tagSummary: TagCountItem[];
  activeTag: string | null;
  newCategory: string;
  editingCategoryId: string | null;
  editingCategoryName: string;
  draggedCategoryId: string | null;
  busy: boolean;
  reordering: boolean;
  onNewCategoryChange: (value: string) => void;
  onSubmitCategory: (event: FormEvent) => void;
  onStartEditCategory: (category: Category) => void;
  onCancelEditCategory: () => void;
  onEditingCategoryNameChange: (value: string) => void;
  onSubmitCategoryEdit: (event: FormEvent, id: string) => void;
  onDeleteCategory: (category: Category) => void;
  onDragStartCategory: (id: string) => void;
  onDragEndCategory: () => void;
  onDropCategory: (event: DragEvent<HTMLDivElement>, targetId: string) => void;
  onMoveCategory: (id: string, offset: -1 | 1) => void;
  onSelectTag: (tag: string | null) => void;
}

export function BookmarkCategorySidebar({
  categories,
  tagSummary,
  activeTag,
  newCategory,
  editingCategoryId,
  editingCategoryName,
  draggedCategoryId,
  busy,
  reordering,
  onNewCategoryChange,
  onSubmitCategory,
  onStartEditCategory,
  onCancelEditCategory,
  onEditingCategoryNameChange,
  onSubmitCategoryEdit,
  onDeleteCategory,
  onDragStartCategory,
  onDragEndCategory,
  onDropCategory,
  onMoveCategory,
  onSelectTag,
}: Props) {
  const { tx } = useI18n();

  return (
    <aside className="manager-sidebar bookmark-sidebar">
      <div className="form-card">
        <div className="card-heading">
          <h2>{tx("Categories", "分类")}</h2>
          <span>{categories.length}</span>
        </div>
        <form className="compact-form" onSubmit={onSubmitCategory}>
          <input
            value={newCategory}
            onChange={(event) => onNewCategoryChange(event.target.value)}
            placeholder={tx("New category", "新建分类")}
            maxLength={80}
            aria-label={tx("New category name", "新建分类名称")}
          />
          <button className="secondary" disabled={busy || !newCategory.trim()}>
            {tx("Add", "添加")}
          </button>
        </form>
        <div className="category-list">
          {categories.map((category, index) => (
            <div
              className={`category-row reorder-row${draggedCategoryId === category.id ? " is-dragging" : ""}`}
              key={category.id}
              draggable={editingCategoryId !== category.id && !reordering}
              onDragStart={() => onDragStartCategory(category.id)}
              onDragEnd={onDragEndCategory}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDropCategory(event, category.id)}
            >
              {editingCategoryId === category.id ? (
                <form className="category-edit" onSubmit={(event) => onSubmitCategoryEdit(event, category.id)}>
                  <input
                    autoFocus
                    value={editingCategoryName}
                    onChange={(event) => onEditingCategoryNameChange(event.target.value)}
                    aria-label={tx(`Rename ${category.name}`, `重命名 ${category.name}`)}
                  />
                  <button className="text-action" disabled={busy}>{tx("Save", "保存")}</button>
                  <button className="text-action muted-action" type="button" onClick={onCancelEditCategory}>
                    {tx("Cancel", "取消")}
                  </button>
                </form>
              ) : (
                <>
                  <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                  <span>{category.icon ?? "#"}</span>
                  <strong title={category.name}>{category.name}</strong>
                  <div className="row-actions">
                    <button
                      className="text-action reorder-action"
                      type="button"
                      disabled={reordering || index === 0}
                      aria-label={tx(`Move ${category.name} up`, `将 ${category.name} 上移`)}
                      onClick={() => onMoveCategory(category.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="text-action reorder-action"
                      type="button"
                      disabled={reordering || index === categories.length - 1}
                      aria-label={tx(`Move ${category.name} down`, `将 ${category.name} 下移`)}
                      onClick={() => onMoveCategory(category.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => onStartEditCategory(category)}
                    >
                      {tx("Rename", "重命名")}
                    </button>
                    <button
                      className="text-action danger-text"
                      type="button"
                      onClick={() => onDeleteCategory(category)}
                    >
                      {tx("Delete", "删除")}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!categories.length && <p className="empty-copy">{tx("No categories yet.", "暂无分类。")}</p>}
        </div>
      </div>

      <div className="form-card tag-browser-card">
        <div className="card-heading">
          <div>
            <h2>{tx("Tags", "标签")}</h2>
            <p>{tx("Filter the library or type #tag in search.", "点击筛选书签，或在搜索中使用 #标签。")}</p>
          </div>
          <span>{tagSummary.length}</span>
        </div>
        {activeTag && (
          <button className="active-tag-filter" type="button" onClick={() => onSelectTag(null)}>
            <span>#{activeTag}</span>
            <strong>×</strong>
          </button>
        )}
        <div className="tag-browser-list">
          {tagSummary.map((tag) => (
            <button
              className={`tag-filter-chip${activeTag?.toLocaleLowerCase() === tag.name.toLocaleLowerCase() ? " active" : ""}`}
              type="button"
              key={tag.name.toLocaleLowerCase()}
              onClick={() => onSelectTag(activeTag?.toLocaleLowerCase() === tag.name.toLocaleLowerCase() ? null : tag.name)}
            >
              <span>#{tag.name}</span>
              <strong>{tag.count}</strong>
            </button>
          ))}
          {!tagSummary.length && (
            <p className="empty-copy">
              {tx("No tags yet. Add them when editing a bookmark or accept AI suggestions.", "暂无标签。可在编辑书签或采纳 AI 建议时添加。")}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
