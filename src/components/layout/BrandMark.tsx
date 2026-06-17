/**
 * The app's brand mark — the customer-inquiry logo (gear + paper-plane +
 * chat bubbles). Served from the public dir so it works in dev and in the
 * built SPA without bundling. `size` keeps the call sites unchanged.
 */
export default function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className="shrink-0 select-none object-contain"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
