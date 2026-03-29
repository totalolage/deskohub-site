import type { ComponentProps } from "react";

const CornerAccent = ({ style, ...props }: ComponentProps<"svg">) => (
  <svg
    viewBox="0 0 732 808"
    version="1.1"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeMiterlimit: "1.5",
      strokeWidth: "22.92px",
      fill: "currentColor",
      stroke: "currentColor",
      ...style,
    }}
    {...props}
  >
    <title>CornerAccent</title>
    <g transform="matrix(1,0,0,1,-25.622835,-0.640686)">
      <path
        d="M37.081,472.106C37.081,472.106 85.355,360.881 142.557,268.815C258.42,82.337 439.098,26.178 476.938,12.099M145.009,797.103C145.009,797.103 152.566,536.459 340.313,316.774C535.595,88.273 746.009,56.103 746.009,56.103"
        style={{
          fill: "none",
        }}
      />
    </g>
  </svg>
);

export default CornerAccent;
