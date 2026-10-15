export function SectionTitle({ num, title }: { num: string; title: string }) {
  return (
    <h2 className="text-[10px] tracking-[0.18em] uppercase">
      <span className="text-foreground">{num}</span>
      <span className="ml-3 text-muted-foreground">{title}</span>
    </h2>
  );
}
