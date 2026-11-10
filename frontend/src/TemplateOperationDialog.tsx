import { useId, useLayoutEffect, useRef } from "react";

export type TemplateOperation = { title: string; description: string };

export function TemplateOperationDialog({ operation }: { operation: TemplateOperation | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (operation && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!operation && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
    };
  }, [operation]);

  return <dialog ref={ref} className="template-operation-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => event.preventDefault()}>
    <div className="template-operation-spinner" role="status" aria-label="Операция выполняется" />
    <div><h2 id={titleId}>{operation?.title}</h2><p id={descriptionId}>{operation?.description}</p></div>
  </dialog>;
}
