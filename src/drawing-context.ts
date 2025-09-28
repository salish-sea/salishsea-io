import { createContext } from "@lit/context";
import type VectorSource from "ol/source/Vector.js";

const drawingSourceContext = createContext<VectorSource | undefined>('drawingCollection');
export default drawingSourceContext;
