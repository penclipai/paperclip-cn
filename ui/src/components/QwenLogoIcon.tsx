import { cn } from "../lib/utils";

interface QwenLogoIconProps {
  className?: string;
}

export function QwenLogoIcon({ className }: QwenLogoIconProps) {
  return (
    <img
      src="/brands/qwen-logo.png"
      alt="Qwen"
      className={cn(className)}
    />
  );
}
