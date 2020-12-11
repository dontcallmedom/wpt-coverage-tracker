// TODO: move out of proxy?
// Incorporate extensions into the main idlData.idlNames object
// First, merge partial interfaces
Object.keys(idlData.idlExtendedNames || {}).forEach(name => {
  const idlExtensions = idlData.idlExtendedNames[name].filter(o => o.partial);
  if (!idlData.idlNames[name]) {
    // We seed the entry with the first partial
    idlData.idlNames[name] = idlExtensions.shift();
  }
  // we merge all the partial members in the main entry
  idlExtensions.forEach(ext => {
      idlData.idlNames[name].members = idlData.idlNames[name].members.concat(ext.members);
  });
});
// Then bring-in mixins
Object.keys(idlData.idlExtendedNames || {}).forEach(name => {
  const idlExtensions = idlData.idlExtendedNames[name].filter(o => o.includes);
  if (!idlData.idlNames[name]) {
    idlData.idlNames[name] = {
      type: "interface",
      members: []
    };
  }
  idlExtensions.forEach(ext => {
    const mixin = idlData.idlNames[ext.includes];
    if (mixin) {
      idlData.idlNames[name].members = idlData.idlNames[name].members.concat(mixin.members);
    }
  });
});

const idlNames = Object.keys(idlData.idlNames || {});
const interfaces = idlNames.filter(i => idlData.idlNames[i].type === "interface");
var ___errors = [];
var ___tracker = Object
    .fromEntries(
      // TODO: extended names
      idlNames
        .filter(n => idlData.idlNames[n].members || idlData.idlNames[n].values)
        .map(n => {
          const members = idlData.idlNames[n].members || idlData.idlNames[n].values;
          return [n, Object.fromEntries(members.map(m => {
            const name = m.value ? m.value : (m.type === 'constructor' ? '_constructor' : m.name);
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
      if (!idlType || value === undefined || value === null) {
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
          // Dealing with interfaces cast as dictionaries
          const unwrapped = value.___unwrap ? value.___unwrap : value;
          const entries = unwrapped.toJSON ? value.toJSON() : unwrapped;
          return op(Object.fromEntries(Object.entries(entries).map(([k, v]) => {
            const field = idlData.idlNames[idlName].members.find(m => m.name === k);
            return field ? [k, self(v, field.idlType)] : [k,v];
          })), idlName);
        } else if (idlData.idlNames[idlName].type === "enum") {
          return op(value, idlName);
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
    if (idlType.generic === "sequence") {
      if (Array.isArray(value)) {
        value.map(v => logDictionaryFields(v, idlType.idlType[0]));
      }
      return;
    } else if (idlNames.includes(idlType.idlType)) {
      const idlName = idlType.idlType;
      if (idlData.idlNames[idlName].type === "dictionary") {
        const dict = wrapValue({}, idlType);
        Object.entries(value).forEach(([k, v]) => {
          const field = idlData.idlNames[idlName].members.find(m => m.name === k);
          if (field) {
            // exercise the setter to increase the counter
            // and recursively handle sub-dictionaries
            dict[k] = true;
            logDictionaryFields(v, field.idlType);
          }
        });
      }
    }
    return;
  }

  function wrapValue(value, idlType) {
    if (value === undefined) return undefined;
    // Avoid double wrapping
    if (value && value.___unwrap) return value;
    const wrapped = walkIdlTypes((obj, idlName) => {
      if (obj && obj.___unwrap) return obj;
      // we assume this is an enum
      if (typeof obj === "string") {
        if (idlName) {
        // FIXME
          ___tracker[idlName][obj] += 1;
        }
        return obj;
      }
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
    return walkIdlTypes(v => v && v.___unwrap ? v.___unwrap : v)(value, idlType);
  }

  function handleArguments(args, interface, operation) {
    // TODO: deal with overloaded operations
    const idlArguments = idlData.idlNames[interface].members.find(m => (operation === "constructor" ? m.type === "constructor" : m.name === operation)).arguments;
    return args.map((arg,i) => {
      if (!idlArguments[i]) {
        return arg;
      }
      const idlType = idlArguments[i].idlType;
      // count dictionaries / enums usage
      logDictionaryFields(arg, idlType);
      // unwrap objects that might have been passed as arguments
      return unwrapValue(arg, idlType);
    });
  }

  return {
    construct(target, args) {
      try {
        log("constructor");
        let obj;
        obj = new target(...handleArguments(args, name, "constructor"));
        return new Proxy(obj, logger(name));
      } catch (e) {
        ___errors.push(`Proxy error when trying to construct ${name}: ${e}`);
        return new target(...args);
      }
    },
    set(target, propKey, value) {
      try {
        const idlProp = idlData.idlNames[name].members.find(m => m.name === propKey);
        if (!idlProp) {
          return Reflect.set(...arguments);
        }
        // FIXME: this shouldn't be possible yet it is
        if (target && !target.___unwrap) log(propKey);
        if (propKey.startsWith("on")) { // TODO: only if type is EventHandler?
          target.addEventListener(propKey.slice(2), value);
          return true;
        }
        log(propKey);
        return Reflect.set(...arguments);
      } catch (e) {
        ___errors.push(`Proxy error when trying to set ${propKey} on ${name}: ${e}`);
        return Reflect.set(...arguments);
      }
    },
    get(target, propKey, receiver) {
      try {
        if (propKey === "___unwrap") {
          return target;
        }
        const val = target[propKey];
        const idlProp = idlData.idlNames[name].members.find(m => m.name === propKey);
        // only track items defined in the IDL fragment
        if (!idlProp) {
          if (typeof val !== 'function') {
            return val;
          }
          return function(...args) {
            const thisVal = this === receiver ? target : this; /* Unwrap the proxy */
            // if we inherit from EventTarget
            // and if there are locally defined event handlers
            // we don't track addEventListener,
            // but we want to track eventhandlers called that way
            // this assumes that https://w3ctag.github.io/design-principles/#always-add-event-handlers is respected (i.e. matching on* attributes exist)
            if (propKey === "addEventListener"
                && interfaces.includes(name)
                // TODO deal with mulitple level of inheritance?
                && idlData.idlNames[name].inheritance === "EventTarget"
                && idlData.idlNames[name].members.some(m => m.idlType && m.idlType.idlType === "EventHandler")) {
              log("on" + args[0]);
            }
            return Reflect.apply(val, thisVal, args);
          };
        }
        // trace via new Error().stack?
        if(typeof val !== 'function') {
          log(propKey.toString());
          return wrapValue(val, idlProp.idlType);
        }
        return function(...args) {
          const thisVal = this === receiver ? target : this; /* Unwrap the proxy */
          log(propKey.toString(), ...args);
          const unwrappedArgs = handleArguments(args, name, propKey);
          const obj = Reflect.apply(val, thisVal, unwrappedArgs);
          return wrapValue(obj, idlProp.idlType);
        };
      } catch (e) {
        ___errors.push(`Proxy error when trying to get ${propKey} on ${name}: ${e}`);
        return Reflect.get(...arguments);
      }

      }
  };
};

for (let i of interfaces) {
  if (!window[i]) continue;
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
