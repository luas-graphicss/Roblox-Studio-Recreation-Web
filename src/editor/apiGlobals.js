function P(name, valueType, description, opts = {}) {
  return {
    kind: "Property", name, valueType, description,
    readOnly: opts.readOnly !== false, deprecated: !!opts.deprecated,
    category: opts.category || "Data",
  };
}
function par(name, type, optional = false, def) {
  return { name, type, optional: !!optional, default: def };
}
function F(name, parameters, returnType, description, opts = {}) {
  return {
    kind: "Function", name, parameters, returnType, description,
    deprecated: !!opts.deprecated, overloads: opts.overloads || null,
  };
}
function M(name, parameters, returnType, description, opts = {}) {
  const f = F(name, parameters, returnType, description, opts);
  f.kind = "Method";
  return f;
}


export const LUAU_GLOBALS = [
  F("print", [par("...", "any")], "void", "Imprime os valores no Output."),
  F("warn", [par("...", "any")], "void", "Imprime os valores no Output como aviso (amarelo)."),
  F("error", [par("message", "any"), par("level", "number", true, "1")], "never", "Lança um erro interrompendo a execução."),
  F("assert", [par("value", "any"), par("errorMessage", "string", true)], "any", "Lança erro se o valor for false/nil; senão retorna o valor."),
  F("type", [par("value", "any")], "string", "Tipo Lua primitivo do valor (nil, number, string, table...)."),
  F("typeof", [par("value", "any")], "string", "Tipo do valor incluindo tipos do Roblox (Vector3, CFrame...)."),
  F("tostring", [par("value", "any")], "string", "Converte o valor para string."),
  F("tonumber", [par("value", "any"), par("base", "number", true, "10")], "number?", "Converte o valor para número, ou nil se impossível."),
  F("pairs", [par("t", "table")], "(function, table)", "Iterador sobre todas as chaves/valores da tabela."),
  F("ipairs", [par("t", "table")], "(function, table, number)", "Iterador sobre a parte array da tabela (1, 2, 3...)."),
  F("next", [par("t", "table"), par("lastKey", "any", true)], "(any, any)", "Próximo par chave/valor da tabela."),
  F("select", [par("index", "number | '#'"), par("...", "any")], "any", "Retorna argumentos a partir do índice, ou a contagem com '#'."),
  F("unpack", [par("list", "table"), par("i", "number", true, "1"), par("j", "number", true)], "...any", "Espalha os elementos da tabela. Prefira table.unpack."),
  F("rawget", [par("t", "table"), par("key", "any")], "any", "Lê da tabela sem invocar metamétodos."),
  F("rawset", [par("t", "table"), par("key", "any"), par("value", "any")], "table", "Escreve na tabela sem invocar metamétodos."),
  F("rawequal", [par("a", "any"), par("b", "any")], "boolean", "Compara sem invocar metamétodos."),
  F("setmetatable", [par("t", "table"), par("metatable", "table?")], "table", "Define a metatable da tabela."),
  F("getmetatable", [par("t", "any")], "table?", "Retorna a metatable do valor."),
  F("pcall", [par("f", "function"), par("...", "any", true)], "(boolean, ...any)", "Chama a função em modo protegido (não propaga erros)."),
  F("xpcall", [par("f", "function"), par("handler", "function"), par("...", "any", true)], "(boolean, ...any)", "pcall com função handler de erro."),
  F("require", [par("module", "ModuleScript")], "any", "Executa o ModuleScript (uma vez) e retorna o valor retornado por ele."),
  F("tick", [], "number", "Segundos desde a época Unix. Prefira os.clock/os.time.", { deprecated: true }),
  F("wait", [par("seconds", "number", true)], "number", "Use task.wait.", { deprecated: true }),
  F("spawn", [par("f", "function")], "void", "Use task.spawn.", { deprecated: true }),
  F("delay", [par("seconds", "number"), par("f", "function")], "void", "Use task.delay.", { deprecated: true }),
];


export const ROBLOX_GLOBAL_VALUES = [
  P("game", "DataModel", "A raiz da hierarquia do jogo."),
  P("workspace", "Workspace", "Atalho para game.Workspace."),
  P("script", "Script", "O script atualmente em execução."),
  P("plugin", "Plugin", "O plugin atual (apenas em scripts de plugin)."),
  P("_G", "table", "Tabela global compartilhada entre scripts do mesmo lado.", { readOnly: false }),
];




export const LUAU_LIBRARIES = {
  table: {
    description: "Funções para manipulação de tabelas/arrays.",
    members: [
      F("insert", [par("t", "table"), par("pos", "number", true), par("value", "any")], "void", "Insere um valor na tabela (no fim, ou na posição dada).", { overloads: ["table.insert(t, value)", "table.insert(t, pos, value)"] }),
      F("remove", [par("t", "table"), par("pos", "number", true)], "any", "Remove e retorna o elemento (do fim, ou da posição dada)."),
      F("sort", [par("t", "table"), par("comp", "function", true)], "void", "Ordena a parte array da tabela in-place."),
      F("find", [par("haystack", "table"), par("needle", "any"), par("init", "number", true, "1")], "number?", "Índice da primeira ocorrência do valor, ou nil."),
      F("concat", [par("t", "table"), par("sep", "string", true, "''"), par("i", "number", true, "1"), par("j", "number", true)], "string", "Concatena os elementos em uma string."),
      F("move", [par("src", "table"), par("a", "number"), par("b", "number"), par("t", "number"), par("dst", "table", true)], "table", "Copia o intervalo [a,b] para a posição t."),
      F("create", [par("count", "number"), par("value", "any", true)], "table", "Cria um array pré-alocado, opcionalmente preenchido."),
      F("getn", [par("t", "table")], "number", "Tamanho do array. Use o operador #.", { deprecated: true }),
      F("clear", [par("t", "table")], "void", "Remove todas as entradas mantendo a capacidade."),
      F("pack", [par("...", "any")], "table", "Empacota os argumentos em uma tabela com campo n."),
      F("unpack", [par("list", "table"), par("i", "number", true, "1"), par("j", "number", true)], "...any", "Espalha os elementos da tabela como múltiplos retornos."),
      F("freeze", [par("t", "table")], "table", "Congela a tabela (somente leitura)."),
      F("isfrozen", [par("t", "table")], "boolean", "True se a tabela está congelada."),
    ],
  },
  string: {
    description: "Funções para manipulação de strings.",
    members: [
      F("format", [par("formatString", "string"), par("...", "any", true)], "string", "Formata valores no estilo printf (%d, %s, %.2f...)."),
      F("len", [par("s", "string")], "number", "Comprimento da string em bytes."),
      F("sub", [par("s", "string"), par("i", "number"), par("j", "number", true, "-1")], "string", "Substring de i até j (índices negativos contam do fim)."),
      F("rep", [par("s", "string"), par("n", "number"), par("sep", "string", true)], "string", "Repete a string n vezes."),
      F("reverse", [par("s", "string")], "string", "Inverte a string."),
      F("upper", [par("s", "string")], "string", "Converte para maiúsculas."),
      F("lower", [par("s", "string")], "string", "Converte para minúsculas."),
      F("byte", [par("s", "string"), par("i", "number", true, "1"), par("j", "number", true)], "...number", "Códigos numéricos dos caracteres."),
      F("char", [par("...", "number")], "string", "String formada pelos códigos dados."),
      F("gmatch", [par("s", "string"), par("pattern", "string")], "function", "Iterador sobre as ocorrências do padrão."),
      F("gsub", [par("s", "string"), par("pattern", "string"), par("replacement", "string | table | function"), par("n", "number", true)], "(string, number)", "Substitui ocorrências do padrão."),
      F("find", [par("s", "string"), par("pattern", "string"), par("init", "number", true, "1"), par("plain", "boolean", true, "false")], "(number?, number?, ...string)", "Posição da primeira ocorrência do padrão."),
      F("match", [par("s", "string"), par("pattern", "string"), par("init", "number", true, "1")], "...string?", "Captura da primeira ocorrência do padrão."),
      F("split", [par("s", "string"), par("separator", "string", true, "','")], "{ string }", "Divide a string pelo separador (extensão Luau)."),
    ],
  },
  math: {
    description: "Funções e constantes matemáticas.",
    members: [
      F("abs", [par("x", "number")], "number", "Valor absoluto."),
      F("ceil", [par("x", "number")], "number", "Arredonda para cima."),
      F("floor", [par("x", "number")], "number", "Arredonda para baixo."),
      F("sqrt", [par("x", "number")], "number", "Raiz quadrada."),
      F("sin", [par("x", "number")], "number", "Seno (radianos)."),
      F("cos", [par("x", "number")], "number", "Cosseno (radianos)."),
      F("tan", [par("x", "number")], "number", "Tangente (radianos)."),
      F("asin", [par("x", "number")], "number", "Arco seno (radianos)."),
      F("acos", [par("x", "number")], "number", "Arco cosseno (radianos)."),
      F("atan", [par("x", "number")], "number", "Arco tangente (radianos)."),
      F("atan2", [par("y", "number"), par("x", "number")], "number", "Arco tangente de y/x usando os sinais."),
      F("exp", [par("x", "number")], "number", "e elevado a x."),
      F("log", [par("x", "number"), par("base", "number", true, "e")], "number", "Logaritmo (natural por padrão)."),
      F("log10", [par("x", "number")], "number", "Logaritmo na base 10."),
      F("max", [par("...", "number")], "number", "Maior dos argumentos."),
      F("min", [par("...", "number")], "number", "Menor dos argumentos."),
      F("pow", [par("x", "number"), par("y", "number")], "number", "x elevado a y. Prefira o operador ^.", { deprecated: true }),
      F("fmod", [par("x", "number"), par("y", "number")], "number", "Resto de x/y (com o sinal de x)."),
      F("modf", [par("x", "number")], "(number, number)", "Partes inteira e fracionária."),
      F("random", [par("m", "number", true), par("n", "number", true)], "number", "Aleatório: [0,1), [1,m] ou [m,n].", { overloads: ["math.random()", "math.random(m)", "math.random(m, n)"] }),
      F("randomseed", [par("x", "number")], "void", "Define a semente do gerador aleatório."),
      F("noise", [par("x", "number"), par("y", "number", true, "0"), par("z", "number", true, "0")], "number", "Ruído Perlin determinístico (-0.5 a 0.5 aprox)."),
      F("sign", [par("x", "number")], "number", "-1, 0 ou 1 conforme o sinal."),
      F("clamp", [par("x", "number"), par("min", "number"), par("max", "number")], "number", "Limita x ao intervalo [min, max]."),
      F("round", [par("x", "number")], "number", "Arredonda para o inteiro mais próximo."),
      P("huge", "number", "Infinito positivo (math.huge)."),
      P("pi", "number", "A constante \u03c0 (3.14159...)."),
    ],
  },
  os: {
    description: "Funções de data e tempo (subset seguro do Luau).",
    members: [
      F("time", [par("timeTable", "table", true)], "number", "Timestamp Unix atual (ou da tabela de data dada)."),
      F("clock", [], "number", "Tempo de CPU em segundos (alta precisão, para benchmarks)."),
      F("date", [par("formatString", "string", true), par("time", "number", true)], "string | table", "Formata uma data (ou retorna tabela com *t)."),
      F("difftime", [par("t2", "number"), par("t1", "number")], "number", "Diferença em segundos entre dois tempos."),
    ],
  },
  task: {
    description: "Agendamento de tarefas no scheduler do Roblox (substitui wait/spawn/delay).",
    members: [
      F("wait", [par("duration", "number", true)], "number", "Pausa a thread atual; retorna o tempo realmente decorrido."),
      F("spawn", [par("functionOrThread", "function | thread"), par("...", "any", true)], "thread", "Executa a função em uma nova thread imediatamente."),
      F("defer", [par("functionOrThread", "function | thread"), par("...", "any", true)], "thread", "Executa a função no fim do passo atual do scheduler."),
      F("delay", [par("duration", "number"), par("functionOrThread", "function | thread"), par("...", "any", true)], "thread", "Executa a função após a duração dada."),
      F("cancel", [par("thread", "thread")], "void", "Cancela uma thread agendada."),
    ],
  },
  bit32: {
    description: "Operações bit a bit sobre inteiros de 32 bits.",
    members: [
      F("band", [par("...", "number")], "number", "AND bit a bit."),
      F("bor", [par("...", "number")], "number", "OR bit a bit."),
      F("bxor", [par("...", "number")], "number", "XOR bit a bit."),
      F("bnot", [par("x", "number")], "number", "NOT bit a bit."),
      F("lshift", [par("x", "number"), par("disp", "number")], "number", "Shift lógico à esquerda."),
      F("rshift", [par("x", "number"), par("disp", "number")], "number", "Shift lógico à direita."),
      F("arshift", [par("x", "number"), par("disp", "number")], "number", "Shift aritmético à direita."),
      F("extract", [par("n", "number"), par("field", "number"), par("width", "number", true, "1")], "number", "Extrai um campo de bits."),
      F("replace", [par("n", "number"), par("v", "number"), par("field", "number"), par("width", "number", true, "1")], "number", "Substitui um campo de bits."),
      F("countlz", [par("n", "number")], "number", "Conta zeros à esquerda."),
      F("countrz", [par("n", "number")], "number", "Conta zeros à direita."),
      F("byteswap", [par("n", "number")], "number", "Inverte a ordem dos bytes."),
    ],
  },
  coroutine: {
    description: "Criação e controle de corrotinas.",
    members: [
      F("create", [par("f", "function")], "thread", "Cria uma corrotina."),
      F("resume", [par("co", "thread"), par("...", "any", true)], "(boolean, ...any)", "Retoma a corrotina."),
      F("yield", [par("...", "any", true)], "...any", "Suspende a corrotina atual."),
      F("status", [par("co", "thread")], "string", "Estado da corrotina."),
      F("wrap", [par("f", "function")], "function", "Cria uma corrotina encapsulada em função."),
    ],
  },
};





export const API_DATATYPES = {
  Vector3: {
    description: "Vetor 3D (x, y, z). Imutável.",
    statics: [
      F("new", [par("x", "number", true, "0"), par("y", "number", true, "0"), par("z", "number", true, "0")], "Vector3", "Cria um novo Vector3."),
      P("zero", "Vector3", "Vector3 (0, 0, 0)."),
      P("one", "Vector3", "Vector3 (1, 1, 1)."),
      P("xAxis", "Vector3", "Vector3 (1, 0, 0)."),
      P("yAxis", "Vector3", "Vector3 (0, 1, 0)."),
      P("zAxis", "Vector3", "Vector3 (0, 0, 1)."),
      F("FromNormalId", [par("normal", "Enum.NormalId")], "Vector3", "Vetor unitário da face dada."),
    ],
    members: [
      P("X", "number", "Componente X."),
      P("Y", "number", "Componente Y."),
      P("Z", "number", "Componente Z."),
      P("Magnitude", "number", "Comprimento do vetor."),
      P("Unit", "Vector3", "Vetor normalizado (comprimento 1)."),
      M("Dot", [par("other", "Vector3")], "number", "Produto escalar."),
      M("Cross", [par("other", "Vector3")], "Vector3", "Produto vetorial."),
      M("Lerp", [par("goal", "Vector3"), par("alpha", "number")], "Vector3", "Interpola linearmente até goal."),
      M("FuzzyEq", [par("other", "Vector3"), par("epsilon", "number", true, "1e-5")], "boolean", "Comparação aproximada."),
    ],
  },
  Vector2: {
    description: "Vetor 2D (x, y). Imutável.",
    statics: [
      F("new", [par("x", "number", true, "0"), par("y", "number", true, "0")], "Vector2", "Cria um novo Vector2."),
      P("zero", "Vector2", "Vector2 (0, 0)."),
      P("one", "Vector2", "Vector2 (1, 1)."),
    ],
    members: [
      P("X", "number", "Componente X."),
      P("Y", "number", "Componente Y."),
      P("Magnitude", "number", "Comprimento do vetor."),
      P("Unit", "Vector2", "Vetor normalizado."),
      M("Dot", [par("other", "Vector2")], "number", "Produto escalar."),
      M("Lerp", [par("goal", "Vector2"), par("alpha", "number")], "Vector2", "Interpola linearmente até goal."),
    ],
  },
  CFrame: {
    description: "Posição + rotação no espaço 3D (coordinate frame). Imutável.",
    statics: [
      F("new", [par("x", "number", true), par("y", "number", true), par("z", "number", true)], "CFrame", "Cria um CFrame.", { overloads: ["CFrame.new()", "CFrame.new(pos: Vector3)", "CFrame.new(x, y, z)", "CFrame.new(pos: Vector3, lookAt: Vector3)", "CFrame.new(x, y, z, qX, qY, qZ, qW)", "CFrame.new(x, y, z, R00, R01, R02, R10, R11, R12, R20, R21, R22)"] }),
      F("lookAt", [par("at", "Vector3"), par("lookAt", "Vector3"), par("up", "Vector3", true)], "CFrame", "CFrame em 'at' olhando para 'lookAt'."),
      F("Angles", [par("rx", "number"), par("ry", "number"), par("rz", "number")], "CFrame", "Rotação por ângulos de Euler (radianos)."),
      F("fromEulerAnglesXYZ", [par("rx", "number"), par("ry", "number"), par("rz", "number")], "CFrame", "Rotação XYZ em radianos."),
      F("fromOrientation", [par("rx", "number"), par("ry", "number"), par("rz", "number")], "CFrame", "Rotação YXZ em radianos (como Orientation)."),
      F("fromMatrix", [par("pos", "Vector3"), par("vX", "Vector3"), par("vY", "Vector3"), par("vZ", "Vector3", true)], "CFrame", "CFrame a partir de vetores de base."),
      F("fromAxisAngle", [par("axis", "Vector3"), par("angle", "number")], "CFrame", "Rotação em torno de um eixo (radianos)."),
      P("identity", "CFrame", "CFrame identidade (origem, sem rotação)."),
    ],
    members: [
      P("Position", "Vector3", "Componente de posição."),
      P("Rotation", "CFrame", "Apenas a rotação (posição zerada)."),
      P("LookVector", "Vector3", "Direção para frente (-Z)."),
      P("RightVector", "Vector3", "Direção para a direita (+X)."),
      P("UpVector", "Vector3", "Direção para cima (+Y)."),
      P("X", "number", "Posição X."),
      P("Y", "number", "Posição Y."),
      P("Z", "number", "Posição Z."),
      M("Inverse", [], "CFrame", "CFrame inverso."),
      M("Lerp", [par("goal", "CFrame"), par("alpha", "number")], "CFrame", "Interpola até goal."),
      M("ToWorldSpace", [par("cf", "CFrame")], "CFrame", "Composição self * cf."),
      M("ToObjectSpace", [par("cf", "CFrame")], "CFrame", "Composição self:Inverse() * cf."),
      M("PointToWorldSpace", [par("point", "Vector3")], "Vector3", "Transforma ponto local em mundial."),
      M("PointToObjectSpace", [par("point", "Vector3")], "Vector3", "Transforma ponto mundial em local."),
      M("VectorToWorldSpace", [par("vector", "Vector3")], "Vector3", "Rotaciona vetor local para mundial."),
      M("VectorToObjectSpace", [par("vector", "Vector3")], "Vector3", "Rotaciona vetor mundial para local."),
      M("ToEulerAnglesXYZ", [], "(number, number, number)", "Ângulos de Euler XYZ (radianos)."),
      M("ToOrientation", [], "(number, number, number)", "Ângulos YXZ (radianos)."),
      M("ToAxisAngle", [], "(Vector3, number)", "Eixo unitário e ângulo (radianos) da rotação."),
      M("GetComponents", [], "...number", "Os 12 componentes da matriz."),
    ],
  },
  Color3: {
    description: "Cor RGB com componentes de 0 a 1. Imutável.",
    statics: [
      F("new", [par("r", "number", true, "0"), par("g", "number", true, "0"), par("b", "number", true, "0")], "Color3", "Cria uma cor com componentes 0 a 1."),
      F("fromRGB", [par("r", "number", true, "0"), par("g", "number", true, "0"), par("b", "number", true, "0")], "Color3", "Cria uma cor com componentes 0 a 255."),
      F("fromHSV", [par("h", "number"), par("s", "number"), par("v", "number")], "Color3", "Cria uma cor a partir de matiz/saturação/valor."),
      F("fromHex", [par("hex", "string")], "Color3", "Cria uma cor a partir de hex (#RRGGBB)."),
    ],
    members: [
      P("R", "number", "Componente vermelho (0 a 1)."),
      P("G", "number", "Componente verde (0 a 1)."),
      P("B", "number", "Componente azul (0 a 1)."),
      M("Lerp", [par("goal", "Color3"), par("alpha", "number")], "Color3", "Interpola até a cor goal."),
      M("ToHSV", [], "(number, number, number)", "Converte para matiz/saturação/valor."),
      M("ToHex", [], "string", "Converte para hex (RRGGBB)."),
    ],
  },
  BrickColor: {
    description: "Cor da paleta clássica do Roblox.",
    statics: [
      F("new", [par("name", "string")], "BrickColor", "Cria pela paleta.", { overloads: ["BrickColor.new(name: string)", "BrickColor.new(number)", "BrickColor.new(r, g, b)", "BrickColor.new(color: Color3)"] }),
      F("random", [], "BrickColor", "BrickColor aleatório."),
      F("Red", [], "BrickColor", "BrickColor 'Bright red'."),
      F("Blue", [], "BrickColor", "BrickColor 'Bright blue'."),
      F("Green", [], "BrickColor", "BrickColor 'Dark green'."),
      F("White", [], "BrickColor", "BrickColor 'White'."),
      F("Black", [], "BrickColor", "BrickColor 'Black'."),
    ],
    members: [
      P("Name", "string", "Nome da cor na paleta."),
      P("Number", "number", "Índice da cor na paleta."),
      P("Color", "Color3", "Equivalente Color3."),
      P("r", "number", "Componente vermelho (0 a 1)."),
      P("g", "number", "Componente verde (0 a 1)."),
      P("b", "number", "Componente azul (0 a 1)."),
    ],
  },
  UDim: {
    description: "Dimensão 1D: Scale (relativo) + Offset (pixels).",
    statics: [F("new", [par("scale", "number", true, "0"), par("offset", "number", true, "0")], "UDim", "Cria um UDim.")],
    members: [
      P("Scale", "number", "Componente relativo (fração do pai)."),
      P("Offset", "number", "Componente absoluto em pixels."),
    ],
  },
  UDim2: {
    description: "Dimensão 2D para posição/tamanho de GUI (X e Y como UDim).",
    statics: [
      F("new", [par("xScale", "number", true, "0"), par("xOffset", "number", true, "0"), par("yScale", "number", true, "0"), par("yOffset", "number", true, "0")], "UDim2", "Cria um UDim2.", { overloads: ["UDim2.new(xScale, xOffset, yScale, yOffset)", "UDim2.new(x: UDim, y: UDim)"] }),
      F("fromScale", [par("xScale", "number"), par("yScale", "number")], "UDim2", "UDim2 apenas com Scale."),
      F("fromOffset", [par("xOffset", "number"), par("yOffset", "number")], "UDim2", "UDim2 apenas com Offset."),
    ],
    members: [
      P("X", "UDim", "Componente X."),
      P("Y", "UDim", "Componente Y."),
      P("Width", "UDim", "Alias de X."),
      P("Height", "UDim", "Alias de Y."),
      M("Lerp", [par("goal", "UDim2"), par("alpha", "number")], "UDim2", "Interpola até goal."),
    ],
  },
  Rect: {
    description: "Retângulo 2D definido por dois cantos.",
    statics: [F("new", [par("minX", "number"), par("minY", "number"), par("maxX", "number"), par("maxY", "number")], "Rect", "Cria um Rect.", { overloads: ["Rect.new(min: Vector2, max: Vector2)", "Rect.new(minX, minY, maxX, maxY)"] })],
    members: [
      P("Min", "Vector2", "Canto mínimo."),
      P("Max", "Vector2", "Canto máximo."),
      P("Width", "number", "Largura."),
      P("Height", "number", "Altura."),
    ],
  },
  Ray: {
    description: "Raio: origem + direção.",
    statics: [F("new", [par("origin", "Vector3"), par("direction", "Vector3")], "Ray", "Cria um Ray.")],
    members: [
      P("Origin", "Vector3", "Ponto de origem."),
      P("Direction", "Vector3", "Direção (e alcance) do raio."),
      P("Unit", "Ray", "Raio com direção normalizada."),
      M("ClosestPoint", [par("point", "Vector3")], "Vector3", "Ponto do raio mais próximo do ponto dado."),
      M("Distance", [par("point", "Vector3")], "number", "Distância do ponto ao raio."),
    ],
  },
  Region3: {
    description: "Região 3D em caixa alinhada aos eixos.",
    statics: [F("new", [par("min", "Vector3"), par("max", "Vector3")], "Region3", "Cria uma Region3 entre dois cantos.")],
    members: [
      P("CFrame", "CFrame", "Centro da região."),
      P("Size", "Vector3", "Tamanho da região."),
      M("ExpandToGrid", [par("resolution", "number")], "Region3", "Expande para alinhar à grade de voxels."),
    ],
  },
  NumberRange: {
    description: "Intervalo numérico (min, max).",
    statics: [F("new", [par("min", "number"), par("max", "number", true)], "NumberRange", "Cria um intervalo (max = min se omitido).")],
    members: [
      P("Min", "number", "Valor mínimo."),
      P("Max", "number", "Valor máximo."),
    ],
  },
  NumberSequence: {
    description: "Sequência de números ao longo de 0 a 1 (keypoints).",
    statics: [F("new", [par("value", "number | { NumberSequenceKeypoint }")], "NumberSequence", "Cria a sequência.", { overloads: ["NumberSequence.new(value: number)", "NumberSequence.new(value0, value1)", "NumberSequence.new(keypoints: { NumberSequenceKeypoint })"] })],
    members: [P("Keypoints", "{ NumberSequenceKeypoint }", "Keypoints da sequência.")],
  },
  NumberSequenceKeypoint: {
    description: "Keypoint de uma NumberSequence.",
    statics: [F("new", [par("time", "number"), par("value", "number"), par("envelope", "number", true, "0")], "NumberSequenceKeypoint", "Cria um keypoint.")],
    members: [
      P("Time", "number", "Posição na sequência (0 a 1)."),
      P("Value", "number", "Valor no keypoint."),
      P("Envelope", "number", "Variação aleatória permitida."),
    ],
  },
  ColorSequence: {
    description: "Sequência de cores ao longo de 0 a 1 (keypoints).",
    statics: [F("new", [par("value", "Color3 | { ColorSequenceKeypoint }")], "ColorSequence", "Cria a sequência.", { overloads: ["ColorSequence.new(color: Color3)", "ColorSequence.new(color0, color1)", "ColorSequence.new(keypoints: { ColorSequenceKeypoint })"] })],
    members: [P("Keypoints", "{ ColorSequenceKeypoint }", "Keypoints da sequência.")],
  },
  ColorSequenceKeypoint: {
    description: "Keypoint de uma ColorSequence.",
    statics: [F("new", [par("time", "number"), par("color", "Color3")], "ColorSequenceKeypoint", "Cria um keypoint.")],
    members: [
      P("Time", "number", "Posição na sequência (0 a 1)."),
      P("Value", "Color3", "Cor no keypoint."),
    ],
  },
  TweenInfo: {
    description: "Parâmetros de tempo/easing para TweenService:Create().",
    statics: [F("new", [par("time", "number", true, "1"), par("easingStyle", "Enum.EasingStyle", true, "Quad"), par("easingDirection", "Enum.EasingDirection", true, "Out"), par("repeatCount", "number", true, "0"), par("reverses", "boolean", true, "false"), par("delayTime", "number", true, "0")], "TweenInfo", "Cria um TweenInfo.")],
    members: [
      P("Time", "number", "Duração em segundos."),
      P("EasingStyle", "Enum.EasingStyle", "Estilo de easing."),
      P("EasingDirection", "Enum.EasingDirection", "Direção do easing."),
      P("RepeatCount", "number", "Repetições (-1 = infinito)."),
      P("Reverses", "boolean", "Se volta ao valor inicial."),
      P("DelayTime", "number", "Atraso antes de iniciar."),
    ],
  },
  PhysicalProperties: {
    description: "Propriedades físicas customizadas de uma BasePart.",
    statics: [F("new", [par("density", "number"), par("friction", "number", true), par("elasticity", "number", true), par("frictionWeight", "number", true), par("elasticityWeight", "number", true)], "PhysicalProperties", "Cria propriedades físicas.", { overloads: ["PhysicalProperties.new(material: Enum.Material)", "PhysicalProperties.new(density, friction, elasticity)", "PhysicalProperties.new(density, friction, elasticity, frictionWeight, elasticityWeight)"] })],
    members: [
      P("Density", "number", "Densidade do material."),
      P("Friction", "number", "Atrito (0 a 2)."),
      P("Elasticity", "number", "Elasticidade (0 a 1)."),
      P("FrictionWeight", "number", "Peso do atrito na combinação."),
      P("ElasticityWeight", "number", "Peso da elasticidade na combinação."),
    ],
  },
  OverlapParams: {
    description: "Parâmetros para queries espaciais (GetPartBoundsInBox etc.).",
    statics: [F("new", [], "OverlapParams", "Cria parâmetros padrão.")],
    members: [
      P("FilterDescendantsInstances", "{ Instance }", "Instâncias filtradas (com descendentes).", { readOnly: false }),
      P("FilterType", "Enum.RaycastFilterType", "Include ou Exclude.", { readOnly: false }),
      P("MaxParts", "number", "Máximo de partes retornadas (0 = sem limite).", { readOnly: false }),
      P("CollisionGroup", "string", "Grupo de colisão usado na query.", { readOnly: false }),
      P("RespectCanCollide", "boolean", "Considera apenas partes com CanCollide.", { readOnly: false }),
      P("Tolerance", "number", "Tolerância extra de sobreposição (studs).", { readOnly: false }),
      P("BruteForceAllSlow", "boolean", "Desativa otimizações da broadphase (lento).", { readOnly: false }),
      P("IncludeInstances", "{ Instance }", "Lista de inclusão adicional (nil = permissivo).", { readOnly: false }),
      P("ExcludeInstances", "{ Instance }", "Lista de exclusão (tem prioridade sobre inclusão).", { readOnly: false }),
    ],
  },
  RaycastParams: {
    description: "Parâmetros para Workspace:Raycast().",
    statics: [F("new", [], "RaycastParams", "Cria parâmetros padrão.")],
    members: [
      P("FilterDescendantsInstances", "{ Instance }", "Instâncias filtradas (com descendentes).", { readOnly: false }),
      P("FilterType", "Enum.RaycastFilterType", "Include ou Exclude.", { readOnly: false }),
      P("IgnoreWater", "boolean", "Ignora água do terreno.", { readOnly: false }),
      P("CollisionGroup", "string", "Grupo de colisão usado no raycast.", { readOnly: false }),
      P("RespectCanCollide", "boolean", "Considera apenas partes com CanCollide.", { readOnly: false }),
      P("BruteForceAllSlow", "boolean", "Desativa otimizações da broadphase (lento).", { readOnly: false }),
    ],
  },
  RaycastResult: {
    description: "Resultado de um raycast (retornado por Workspace:Raycast).",
    statics: [],
    members: [
      P("Instance", "BasePart", "Parte atingida pelo raio."),
      P("Position", "Vector3", "Ponto de impacto no mundo."),
      P("Normal", "Vector3", "Normal da superfície no impacto."),
      P("Material", "Enum.Material", "Material da superfície atingida."),
      P("Distance", "number", "Distância da origem ao impacto."),
    ],
  },
  Instance: {
    description: "Construtor de instâncias: Instance.new(className).",
    statics: [F("new", [par("className", "string"), par("parent", "Instance", true)], "Instance", "Cria uma nova instância da classe dada.")],
    members: [],
  },
  Random: {
    description: "Gerador de números pseudoaleatórios com estado.",
    statics: [F("new", [par("seed", "number", true)], "Random", "Cria um gerador (semente opcional).")],
    members: [
      M("NextNumber", [par("min", "number", true, "0"), par("max", "number", true, "1")], "number", "Número aleatório no intervalo."),
      M("NextInteger", [par("min", "number"), par("max", "number")], "number", "Inteiro aleatório no intervalo."),
      M("NextUnitVector", [], "Vector3", "Vetor unitário aleatório."),
      M("Clone", [], "Random", "Copia o gerador com o mesmo estado."),
    ],
  },
};




export const SNIPPETS = [
  { label: "for", description: "Loop numérico: for i = 1, n do ... end", insertText: "for ${1:i} = ${2:1}, ${3:10} do\n\t${0}\nend" },
  { label: "forin", description: "Loop genérico: for k, v in pairs(t) do ... end", insertText: "for ${1:k}, ${2:v} in pairs(${3:t}) do\n\t${0}\nend" },
  { label: "function", description: "Declaração de função global.", insertText: "function ${1:nome}(${2})\n\t${0}\nend" },
  { label: "localfunction", description: "Declaração de função local.", insertText: "local function ${1:nome}(${2})\n\t${0}\nend" },
  { label: "if", description: "Bloco condicional if ... then ... end", insertText: "if ${1:condition} then\n\t${0}\nend" },
  { label: "while", description: "Loop while ... do ... end", insertText: "while ${1:condition} do\n\t${0}\nend" },
  { label: "repeat", description: "Loop repeat ... until ...", insertText: "repeat\n\t${0}\nuntil ${1:condition}" },
  { label: "pcall", description: "Chamada protegida com pcall.", insertText: "local ${1:ok}, ${2:err} = pcall(function()\n\t${0}\nend)" },
  { label: "xpcall", description: "Chamada protegida com handler de erro.", insertText: "local ${1:ok}, ${2:result} = xpcall(function()\n\t${0}\nend, function(err)\n\twarn(err)\n\treturn err\nend)" },
  { label: "remoteEvent", description: "Boilerplate de RemoteEvent com Connect.", insertText: "local ${1:remoteEvent} = game:GetService(\"ReplicatedStorage\"):WaitForChild(\"${2:RemoteEvent}\")\n\n${1:remoteEvent}.OnServerEvent:Connect(function(player, ${3:...})\n\t${0}\nend)" },
  { label: "remoteFunction", description: "Boilerplate de RemoteFunction com OnServerInvoke.", insertText: "local ${1:remoteFunction} = game:GetService(\"ReplicatedStorage\"):WaitForChild(\"${2:RemoteFunction}\")\n\n${1:remoteFunction}.OnServerInvoke = function(player, ${3:...})\n\treturn ${0}\nend" },
];





export const DEPRECATED_GLOBAL_FIXES = {
  wait: "task.wait",
  spawn: "task.spawn",
  delay: "task.delay",
};

export const DEPRECATED_MEMBER_FIXES = {
  connect: "Connect",
  disconnect: "Disconnect",
  findFirstChild: "FindFirstChild",
  clone: "Clone",
  destroy: "Destroy",
  isA: "IsA",
  getChildren: "GetChildren",
  remove: "Destroy",
  LoadAnimation: "Animator:LoadAnimation (via Humanoid:FindFirstChildOfClass('Animator'))",
  SetPrimaryPartCFrame: "PivotTo",
  BreakJoints: "(sem substituto direto; use constraints)",
  Pitch: "PlaybackSpeed",
  Disabled: "Enabled",
  Velocity: "AssemblyLinearVelocity",
  RotVelocity: "AssemblyAngularVelocity",
};

function deepFreeze(obj) {
  if (!obj || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) deepFreeze(obj[key]);
  return obj;
}
deepFreeze(LUAU_GLOBALS);
deepFreeze(ROBLOX_GLOBAL_VALUES);
deepFreeze(LUAU_LIBRARIES);
deepFreeze(API_DATATYPES);
deepFreeze(SNIPPETS);
deepFreeze(DEPRECATED_GLOBAL_FIXES);
deepFreeze(DEPRECATED_MEMBER_FIXES);
