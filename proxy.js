
const idlNames = Object.keys(idlData.idlNames || {});
const interfaces = idlNames.filter(i => idlData.idlNames[i].type === "interface");
var ___tracker = Object
    .fromEntries(
      // TODO: extended names
      idlNames
      // TODO: enums
        .filter(n => idlData.idlNames[n].members)
        .map(n => {
          const members = idlData.idlNames[n].members;
          return [n, Object.fromEntries(members.map(m => {
            const name = m.type === 'constructor' ? '_constructor' : m.name;
            return [name, 0];
          }))];
        }));
var ___orig = {};
var ___puppeteerdone = false;

const logger = name => {
  function log(member, ...args) {
    // console.log("logging " + name + "." + member);
    // console.log(new Error().stack);
    if (member === 'constructor') {
      member = '_constructor';
    }
    ___tracker[name][member] += 1;
  }

  function walkIdlTypes(op) {
    return function self(value, idlType) {
      if (!idlType || !value) {
        return value;
      }
      // TODO: maps, records, unions, typedefs
      if (["sequence", "FrozenArray"].includes(idlType.generic)) {
        if (Array.isArray(value)) {
          return value.map(v => self(v, idlType.idlType[0]));
        } else {
          return value;
        }
      } else if (idlType.generic === "Promise") {
        return value.then(x => self(x, idlType.idlType[0]));
      } else if (idlNames.includes(idlType.idlType)) {
        const idlName = idlType.idlType;
        if (interfaces.includes(idlName)) {
          return op(value, idlName);
        } else if (idlData.idlNames[idlName].type === "dictionary") {
          return op(Object.fromEntries(Object.entries(value).map(([k, v]) => {
            const field = idlData.idlNames[idlName].members.find(m => m.name === k);
            return field ? [k, self(v, field.idlType)] : [k,v];
          })), idlName);
        } else {
          return value;
        }
      } else {
        return value;
      }
    };
  }

  // Passing a dictionary as an argument counts as using it
  // we handle it here
  function logDictionaryFields(value, idlType) {
    if (!idlType || !value) {
      return;
    }
    if (idlNames.includes(idlType.idlType)) {
      const idlName = idlType.idlType;
      if (idlData.idlNames[idlName].type === "dictionary") {
        const dict = wrapValue(value, idlType);
        Object.entries(value).forEach(([k, v]) => {
          const field = idlData.idlNames[idlName].members.find(m => m.name === k);
          if (field) {
            dict[k] = logDictionaryFields(v, field.idlType);
          }
        });
      }
    }
    return;
  }

  function wrapValue(value, idlType) {
    const wrapped = walkIdlTypes((obj, idlName) => {
      const proxy = new Proxy(obj, logger(idlName));
      Object.defineProperty(proxy, "___unwrap", {
        value: obj,
        enumerable: false,
        writable: false,
        configurable: false
      });
      return proxy;
    })(value, idlType);
    return wrapped;
  }

  function unwrapValue(value, idlType) {
    return walkIdlTypes(v => v.___unwrap ? v.___unwrap : v)(value, idlType);
  }

  function handleArguments(args, interface, operation) {
    // TODO: deal with overloaded operations
    const idlArguments = idlData.idlNames[interface].members.find(m => (operation === "constructor" ? m.type === "constructor" : m.name === operation)).arguments;
    return args.map((arg,i) => {
      const idlType = idlArguments[i].idlType;
      // count dictionaries / enums usage
      logDictionaryFields(arg, idlType);
      // unwrap objects that might have been passed as arguments
      return unwrapValue(arg, idlType);
    });
  }

  return {
    construct(target, args) {
      log("constructor");
      let obj;
      obj = new target(...handleArguments(args, name, "constructor"));
      return new Proxy(obj, logger(name));
    },
    set(target, propKey, value) {
      const idlProp = idlData.idlNames[name].members.find(m => m.name === propKey);
      if (!idlProp) {
        return Reflect.set(...arguments);
      }
      log(propKey);
      if (propKey.startsWith("on")) { // TODO: only if type is EventHandler?
        // TODO: events are probably worth tracking independently of EventHandler attributes
        // so maybe we should trap addEventListener where relevant
        target.addEventListener(propKey.slice(2), value);
        return true;
      }
      log(propKey);
      return Reflect.set(...arguments);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    get(target, propKey, receiver) {
      const idlProp = idlData.idlNames[name].members.find(m => m.name === propKey);
      // only track items defined in the IDL fragment
      if (!idlProp) {
        return Reflect.get(...arguments);
      }
      if (propKey === "___unwrap") {
        return target;
      }
      // trace via new Error().stack?
      const val = target[propKey];
      if(typeof val !== 'function') {
        log(propKey.toString());
        return wrapValue(val, idlProp.idlType);
      }
      return function(...args) {
        log(propKey.toString(), ...args);
        var thisVal = this === receiver ? target : this; /* Unwrap the proxy */
        const obj = Reflect.apply(val, thisVal, handleArguments(args, name, propKey));
        return wrapValue(obj, idlProp.idlType);
      };
    }
  };
};

for (let i of interfaces) {
  Object.defineProperty(___orig, i, {
    value: window[i],
    enumerable: false,
    writable: true,
    configurable: true
  });
  // only matters for interfaces with constructor
  window[i] =  new Proxy(___orig[i], logger(i));
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.add_completion_callback) {
    add_completion_callback(() => ___puppeteerdone = true);
  } else {
    ___puppeteerdone = true;
  }
});
