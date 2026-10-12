export type AppRoute = {
  href: string;
  label: string;
};

// The seven routes from the build spec, in mockup navigation order.
export const appRoutes: AppRoute[] = [
  { href: "/", label: "Overview" },
  { href: "/exposure", label: "Exposure" },
  { href: "/adoption", label: "Adoption" },
  { href: "/governance", label: "Governance" },
  { href: "/actions", label: "Action plan" },
  { href: "/methodology", label: "Methodology" },
  { href: "/upload", label: "Upload job architecture" },
];
