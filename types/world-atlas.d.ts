import type { GeometryCollection, Topology } from 'topojson-specification';

declare module 'world-atlas/countries-110m.json' {
  interface CountriesTopology extends Topology {
    objects: {
      countries: GeometryCollection;
      land: GeometryCollection;
    };
  }

  const topology: CountriesTopology;
  export default topology;
}

declare module 'world-atlas/countries-50m.json' {
  interface CountriesTopology extends Topology {
    objects: {
      countries: GeometryCollection;
      land: GeometryCollection;
    };
  }

  const topology: CountriesTopology;
  export default topology;
}
