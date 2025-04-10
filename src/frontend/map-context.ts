import {createContext} from '@lit/context';
import type OpenLayersMap from "ol/Map.js";

const mapContext = createContext<OpenLayersMap>('map');
export default mapContext;
