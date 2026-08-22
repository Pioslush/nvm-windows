"use client";

import { useState } from "react";

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
      onClick={async () => {
        const abs = text.startsWith("/") ? `${window.location.origin}${text}` : text;
        await navigator.clipboard.writeText(abs);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}
