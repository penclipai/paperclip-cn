import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from 'react';
import type { CompanySkillFileDetail } from '@penclipai/shared';
import { Button } from './ui/button';
export function SkillBinaryFile({ file }: { file: CompanySkillFileDetail }) {
  useTranslation();
  const [url, setUrl] = useState('');
  useEffect(() => {
    const bytes = Uint8Array.from(atob(file.content), char => char.charCodeAt(0));
    const href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    setUrl(href); return () => URL.revokeObjectURL(href);
  }, [file.content]);
  return <div className="flex flex-col items-start gap-3 py-6">
    <p className="text-sm text-muted-foreground">{translateInstant("This asset is stored in its original binary format.")}</p>
    <Button asChild variant="outline" className="max-w-full"><a href={url} download={file.path.split('/').at(-1)} title={`Download ${file.path.split('/').at(-1)}`}><span className="truncate">{translateInstant("Download")}{" "}{file.path.split('/').at(-1)}</span></a></Button>
  </div>;
}
