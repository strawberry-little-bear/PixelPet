import type { AdultForm, GrowthStage } from "./types";

export function GrowthOutfit({
  stage,
  form,
}: {
  stage: GrowthStage;
  form: AdultForm | "";
}) {
  return (
    <svg
      className="growth-outfit"
      viewBox="0 0 36 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {stage === "baby" ? (
        <>
          <path d="M6 2h24v4h-4v14H10V6H6z" fill="#a89975" />
          <path d="M10 4h16v14H10z" fill="#fff0c5" />
          <path d="M15 8h6v3h3v3h-3v3h-6v-3h-3v-3h3z" fill="#d0ab81" />
        </>
      ) : stage === "growing" ? (
        <>
          <path d="M3 3h30v5H3zM23 8h7v12h-7z" fill="#b39382" />
          <path d="M4 3h28v2H4zM25 9h2v8h-2z" fill="#d8bd9f" />
        </>
      ) : form === "gentle" ? (
        <>
          <path d="M15 3h6v5h5v6h-5v5h-6v-5h-5V8h5z" fill="#bd9aa7" />
          <path d="M15 8h6v6h-6z" fill="#f2e0ad" />
          <path d="M21 16h9v4h-9z" fill="#9bad7c" />
        </>
      ) : form === "lively" ? (
        <>
          <path d="M3 2h30v5H3zm11 5h12l-8 14z" fill="#bd8e73" />
          <path d="M18 7h6l-5 6h4l-8 7 3-9h-3z" fill="#f6dfa3" />
        </>
      ) : form === "easygoing" ? (
        <>
          <path d="M3 3h30v4H3zm13 4h12v6h-4v5h-8z" fill="#8fa277" />
          <path d="M18 8h3v9h-3z" fill="#c8d6ac" />
        </>
      ) : (
        <>
          <path d="M4 3h28v4H4z" fill="#a3ae85" />
          <path d="M15 5h6v4h5v5h-5v5h-6v-5h-5V9h5z" fill="#e2c88b" />
          <path d="M16 9h4v5h-4z" fill="#fff2c1" />
        </>
      )}
    </svg>
  );
}
export function FormEmblem({ form }: { form: AdultForm | "" }) {
  return (
    <svg
      className="growth-form-emblem"
      viewBox="0 0 24 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {form === "lively" ? (
        <path d="M11 1h9l-6 8h6L7 23l3-12H5z" fill="#b6a36b" />
      ) : form === "gentle" ? (
        <>
          <path d="M9 2h6v5h5v6h-5v5H9v-5H4V7h5z" fill="#b99ca6" />
          <path d="M9 7h6v6H9z" fill="#e6d9a7" />
        </>
      ) : form === "easygoing" ? (
        <>
          <path d="M4 17V8h5V4h12v9h-5v5H7v4H4z" fill="#9bad7c" />
          <path d="M6 17 17 7" stroke="#dce5c0" strokeWidth="2" />
        </>
      ) : (
        <path d="M3 6h4v5h4V4h4v7h4V6h3v14H3z" fill="#b9ab76" />
      )}
    </svg>
  );
}
