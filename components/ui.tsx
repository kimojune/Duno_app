import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 명세 2-3 컴포넌트. 높이는 min-height만 쓴다(D12). 하는 중이면 글을 바꾸고 aria-busy를 단다.
 * 저장 중(명세 ⑭ O-7): busy면 응답 전까지 단추를 막고(disabled) 흐리게 보인다(CSS .btn[aria-busy="true"] 0.45). 글(「저장 중」)은 부르는 쪽이 바꾼다.
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean };

function cls(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function PrimaryButton({ busy, className, ...rest }: ButtonProps) {
  return <button type="button" {...rest} disabled={rest.disabled || busy} aria-busy={busy ? true : undefined} className={cls("btn btn-primary", className)} />;
}

export function SecondaryButton({ busy, className, ...rest }: ButtonProps) {
  return <button type="button" {...rest} disabled={rest.disabled || busy} aria-busy={busy ? true : undefined} className={cls("btn btn-secondary", className)} />;
}

export function TextButton({ busy, className, ...rest }: ButtonProps) {
  return <button type="button" {...rest} disabled={rest.disabled || busy} aria-busy={busy ? true : undefined} className={cls("btn btn-text", className)} />;
}

/** 오류·오프라인·확인 안내. role은 명세 2-6 표대로 호출하는 쪽이 고른다. */
export function Notice({
  role,
  children,
  actions,
  className,
}: {
  role: "alert" | "status";
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div role={role} className={cls("notice", className)}>
      {children}
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </div>
  );
}

/** 페이지마다 하나. 열릴 때부터 DOM에 있어야 한다(명세 2-3). */
export function LiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
