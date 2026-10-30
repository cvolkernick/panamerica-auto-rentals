import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "listing-details": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { "dealer-id": string; "rental-id": string };
    }
  }
}
