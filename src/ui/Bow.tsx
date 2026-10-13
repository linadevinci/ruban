export function Bow({ className }: { className?: string }) {
  return (
    <svg className={className} data-testid="bow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12c-1.6-2.6-4-4.2-6.2-3.6C3.9 8.9 3 10.4 3 12s.9 3.1 2.8 3.6C8 16.2 10.4 14.6 12 12z" />
      <path d="M12 12c1.6-2.6 4-4.2 6.2-3.6C20.1 8.9 21 10.4 21 12s-.9 3.1-2.8 3.6C16 16.2 13.6 14.6 12 12z" />
      <circle cx="12" cy="12" r="1.9" />
      <path d="M11 13.4 8.6 20.4l3.4-2.3 3.4 2.3L13 13.4z" />
    </svg>
  );
}
