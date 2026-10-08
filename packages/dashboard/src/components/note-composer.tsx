import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const NoteComposer = ({
  placeholder,
  onSend,
  onCancel,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<boolean>;
  onCancel?: () => void;
}) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    setBusy(true);
    const ok = await onSend(text.trim());
    setBusy(false);
    setFailed(!ok);
    if (ok) setText("");
  };
  return (
    <div className="grid gap-2">
      <Textarea
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        className="min-h-14"
      />
      <div className="flex items-center justify-end gap-2">
        {failed ? <span className="text-destructive mr-auto text-xs">The note was not saved. Try again.</span> : null}
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button size="sm" disabled={busy || text.trim().length === 0} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </div>
  );
};
