import { registerRootComponent } from "expo";
import "./src/background"; // registers the background sync task; must load before the app starts
import App from "./App";

registerRootComponent(App);
