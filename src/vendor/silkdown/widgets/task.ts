import { WidgetType, type EditorView } from "@codemirror/view";

/** Always rendered (Typora-style): the checkbox is the editable affordance, even with the cursor on the line. */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  override toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "sd-task-checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Mark task open" : "Mark task done");
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: this.checked ? "[ ]" : "[x]",
        },
      });
    });
    return input;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" && event.type !== "click";
  }
}
