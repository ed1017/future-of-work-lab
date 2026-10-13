const MOVE_STYLE: Record<string, string> = {
  redesign: "bg-[#E4E8F8] text-[#27358C]",
  reskill: "bg-[#DDEFEA] text-[#0F5B57]",
  redeploy: "bg-[#FBE3DA] text-[#8A2F14]",
  hold: "bg-muted text-muted-foreground",
};

export function MoveBadge({ move }: { move: string }) {
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${MOVE_STYLE[move] ?? MOVE_STYLE.hold}`}>
      {move}
    </span>
  );
}
