import { createContext } from "@lit/context";
import type Feature from "ol/Feature.js";
import type Point from "ol/geom/Point.js";
import type VectorSource from "ol/source/Vector.js";

const drawingSourceContext = createContext<VectorSource<Feature<Point>> | undefined>('drawingCollection');
export default drawingSourceContext;
