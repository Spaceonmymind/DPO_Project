export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 10.8 18.4 3.6A3 3 0 0 1 23 6.2v12.1a3 3 0 0 1-1.5 2.6L9.1 28.1A3 3 0 0 1 4.6 25.5V13.4A3 3 0 0 1 6 10.8Z"
        fill="#008B76"
      />
      <path
        d="m16.1 17.2 11-6.4a3 3 0 0 1 4.5 2.6v12.1a3 3 0 0 1-1.5 2.6l-11 6.4a3 3 0 0 1-4.5-2.6V19.8a3 3 0 0 1 1.5-2.6Z"
        fill="#58CFAE"
      />
    </svg>
  );
}
