const definitions = require("../src/definitions");
const flatMap = require("array.prototype.flatmap");
const {
  typeSignature,
  iterateProps,
  mapProps,
  filterProps,
  unique
} = require("./util");

const stdout = process.stdout;

const jsTypes = ["string", "number", "boolean"];

function params(fields) {
  const optionalDefault = field => (field.default ? ` = ${field.default}` : "");
  return mapProps(fields)
    .map(field => `${typeSignature(field)}${optionalDefault(field)}`)
    .join(",");
}

function assertParamType({ array, name, type }) {
  if (array) {
    // TODO - assert contents of array?
    return `assert(typeof ${name} === "object" && typeof ${name}.length !== "undefined")\n`;
  } else {
    if (!jsTypes.includes(type)) {
      return "";
    }
    return `assert(typeof ${name} === "${type}")\n`;
  }
}

function assertParam(meta) {
  const paramAssertion = assertParamType(meta);
  if (paramAssertion === "") {
    return "";
  }
  if (meta.maybe || meta.optional) {
    return `
      if (${meta.name} !== null && ${meta.name} !== undefined) {
        ${paramAssertion};
      }
    `;
  } else {
    return paramAssertion;
  }
}

function assertParams(fields) {
  return mapProps(fields)
    .map(assertParam)
    .join("\n");
}

function buildObject(typeDef) {
  const optionalField = meta => {
    if (meta.array) {
      // omit optional array properties if the constructor function was supplied
      // with an empty array
      return `
        if (typeof ${meta.name} !== "undefined" && ${meta.name}.length > 0) {
          node.${meta.name} = ${meta.name};
        }
      `;
    } else if (meta.type === "Object") {
      // omit optional object properties if they have no keys
      return `
        if (typeof ${meta.name} !== "undefined" && Object.keys(${
        meta.name
      }).length !== 0) {
          node.${meta.name} = ${meta.name};
        }
      `;
    } else if (meta.type === "boolean") {
      // TODO: is this a good idea?!
      // omit optional boolean properties if they are not true
      return `
        if (${meta.name} === true) {
          node.${meta.name} = true;
        }
      `;
    } else {
      return `
        if (typeof ${meta.name} !== "undefined") {
          node.${meta.name} = ${meta.name};
        }
      `;
    }
  };

  const fields = mapProps(typeDef.fields)
    .filter(f => !f.optional && !f.constant)
    .map(f => f.name);

  const constants = mapProps(typeDef.fields)
    .filter(f => f.constant)
    .map(f => `${f.name}: "${f.value}"`);

  return `
    const node: ${typeDef.flowTypeName || typeDef.name} = {
      type: "${typeDef.name}",
      ${constants.concat(fields).join(",")}
    }

    ${mapProps(typeDef.fields)
      .filter(f => f.optional)
      .map(optionalField)
      .join("")}
  `;
}

function lowerCamelCase(name) {
  return name.substring(0, 1).toLowerCase() + name.substring(1);
}

function generate() {
  stdout.write(`
    // @flow

    // THIS FILE IS AUTOGENERATED
    // see scripts/generateNodeUtils.js

    import { assert } from "mamacro";

    function isTypeOf(t: string) {
      return (n: Node) => n.type === t;
    }

    function assertTypeOf(t: string) {
      return (n: Node) => assert(n.type === t);
    }
  `);

  // Node builders
  iterateProps(definitions, typeDefinition => {
    stdout.write(`
      export function ${lowerCamelCase(typeDefinition.name)} (
        ${params(filterProps(typeDefinition.fields, f => !f.constant))}
      ): ${typeDefinition.name} {

        ${assertParams(filterProps(typeDefinition.fields, f => !f.constant))}
        ${buildObject(typeDefinition)} 

        return node;
      }
    `);
  });

  // Node testers
  iterateProps(definitions, typeDefinition => {
    stdout.write(`
      export const is${typeDefinition.name} =
        isTypeOf("${typeDefinition.name}");
    `);
  });

  // Node union type testers
  const unionTypes = unique(
    flatMap(mapProps(definitions).filter(d => d.unionType), d => d.unionType)
  );
  unionTypes.forEach(unionType => {
    stdout.write(
      `
      export const is${unionType} = (node: Node) => ` +
        mapProps(definitions)
          .filter(d => d.unionType && d.unionType.includes(unionType))
          .map(d => `is${d.name}(node) `)
          .join("||") +
        ";\n\n"
    );
  });

  // Node assertion
  iterateProps(definitions, typeDefinition => {
    stdout.write(`
      export const assert${typeDefinition.name} =
        assertTypeOf("${typeDefinition.name}");
    `);
  });

  stdout.write(
    `
    export const unionTypesMap = {` +
      mapProps(definitions)
        .filter(d => d.unionType)
        .map(
          t => `"${t.name}": [${t.unionType.map(s => `"${s}"`).join(",")}]\n`
        ) +
      `};`
  );
}

generate();
