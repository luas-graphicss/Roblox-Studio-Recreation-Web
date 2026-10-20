import { MSM_PUBLIC_API } from '../lighting/megalightsSm/msmPublicApiCore.js';
import { SUBSTRATE_PUBLIC_API } from '../lighting/substratePublicApi.js';
import { SSM_PUBLIC_API } from '../lighting/substrateSm/ssmPublicApiCore.js';

function P(name, valueType, description, opts = {}) {
  return {
    kind: "Property", name, valueType, description,
    readOnly: !!opts.readOnly, deprecated: !!opts.deprecated,
    category: opts.category || "Data",
  };
}
function par(name, type, optional = false, def) {
  return { name, type, optional: !!optional, default: def };
}
function M(name, parameters, returnType, description, opts = {}) {
  return {
    kind: "Method", name, parameters, returnType, description,
    deprecated: !!opts.deprecated, overloads: opts.overloads || null,
  };
}
function E(name, parameters, description, opts = {}) {
  return { kind: "Event", name, parameters, description, deprecated: !!opts.deprecated };
}
function CB(name, parameters, returnType, description) {
  return { kind: "Callback", name, parameters, returnType, description };
}
function C(superclass, description, def = {}) {
  return {
    superclass, description,
    properties: def.p || [], methods: def.m || [],
    events: def.e || [], callbacks: def.cb || [],
    deprecated: !!def.deprecated, service: !!def.service,
  };
}


export const API_CLASSES = {

  Instance: C(null, "Classe base de todos os objetos do Roblox.", {
    p: [
      P("Name", "string", "Nome do objeto, exibido no Explorer."),
      P("ClassName", "string", "Nome da classe do objeto.", { readOnly: true }),
      P("Parent", "Instance", "Pai do objeto na hierarquia do DataModel."),
      P("Archivable", "boolean", "Se o objeto pode ser clonado/salvo."),
    ],
    m: [
      M("Clone", [], "Instance", "Cria uma cópia do objeto e de seus descendentes."),
      M("Destroy", [], "void", "Destroi o objeto, trava o Parent e desconecta sinais."),
      M("FindFirstChild", [par("name", "string"), par("recursive", "boolean", true, "false")], "Instance?", "Busca um filho pelo nome. Retorna nil se não existir."),
      M("FindFirstChildOfClass", [par("className", "string")], "Instance?", "Busca o primeiro filho com a classe exata."),
      M("FindFirstChildWhichIsA", [par("className", "string"), par("recursive", "boolean", true, "false")], "Instance?", "Busca o primeiro filho que herda da classe."),
      M("FindFirstAncestor", [par("name", "string")], "Instance?", "Busca um ancestral pelo nome."),
      M("FindFirstAncestorOfClass", [par("className", "string")], "Instance?", "Busca um ancestral pela classe exata."),
      M("FindFirstAncestorWhichIsA", [par("className", "string")], "Instance?", "Busca um ancestral que herda da classe."),
      M("GetChildren", [], "{ Instance }", "Retorna um array com os filhos diretos."),
      M("GetDescendants", [], "{ Instance }", "Retorna um array com todos os descendentes."),
      M("GetFullName", [], "string", "Caminho completo do objeto (ex.: Workspace.Part)."),
      M("IsA", [par("className", "string")], "boolean", "True se o objeto é da classe ou herda dela."),
      M("IsDescendantOf", [par("ancestor", "Instance")], "boolean", "True se o objeto é descendente do ancestral."),
      M("IsAncestorOf", [par("descendant", "Instance")], "boolean", "True se o objeto é ancestral do descendente."),
      M("WaitForChild", [par("name", "string"), par("timeout", "number", true)], "Instance?", "Aguarda (yield) até o filho existir."),
      M("GetAttribute", [par("attribute", "string")], "any", "Lê um atributo customizado."),
      M("SetAttribute", [par("attribute", "string"), par("value", "any")], "void", "Define um atributo customizado."),
      M("GetAttributes", [], "{ [string]: any }", "Retorna todos os atributos como dicionário."),
      M("GetAttributeChangedSignal", [par("attribute", "string")], "RBXScriptSignal", "Sinal disparado quando o atributo indicado muda."),
      M("AddTag", [par("tag", "string")], "void", "Adiciona uma tag (CollectionService) a este objeto."),
      M("RemoveTag", [par("tag", "string")], "void", "Remove uma tag deste objeto."),
      M("HasTag", [par("tag", "string")], "boolean", "True se este objeto possui a tag."),
      M("GetTags", [], "{ string }", "Retorna as tags deste objeto."),
      M("GetPropertyChangedSignal", [par("property", "string")], "RBXScriptSignal", "Sinal disparado quando a propriedade muda."),
      M("ClearAllChildren", [], "void", "Destroi todos os filhos do objeto."),
    ],
    e: [
      E("ChildAdded", [par("child", "Instance")], "Disparado quando um filho é adicionado."),
      E("ChildRemoved", [par("child", "Instance")], "Disparado quando um filho é removido."),
      E("DescendantAdded", [par("descendant", "Instance")], "Disparado quando um descendente é adicionado."),
      E("AncestryChanged", [par("child", "Instance"), par("parent", "Instance")], "Disparado quando a ancestralidade muda."),
      E("Destroying", [], "Disparado imediatamente antes do objeto ser destruído."),
      E("AttributeChanged", [par("attribute", "string")], "Disparado quando um atributo muda."),
      E("Changed", [par("property", "string")], "Disparado quando qualquer propriedade muda."),
    ],
  }),
  PVInstance: C("Instance", "Base de objetos com posição/orientação no mundo 3D.", {
    m: [
      M("GetPivot", [], "CFrame", "Retorna o pivot do objeto no mundo."),
      M("PivotTo", [par("targetCFrame", "CFrame")], "void", "Move o objeto (e descendentes) para o CFrame alvo."),
    ],
  }),
  BasePart: C("PVInstance", "Classe base de todas as partes físicas 3D.", {
    p: [
      P("SubstrateMaterial", "string", SUBSTRATE_PUBLIC_API.SubstrateMaterial.description, { category: "Appearance" }),
      P("EnableFluidForces", "boolean", "Se true, o GlobalWind aplica força física real na parte durante o Playtest. Parte 54.", { category: "Behavior" }),
      P("Anchored", "boolean", "Se true, a parte não é afetada pela física.", { category: "Behavior" }),
      P("CanCollide", "boolean", "Se a parte colide fisicamente com outras.", { category: "Collision" }),
      P("CanTouch", "boolean", "Se a parte dispara eventos Touched.", { category: "Collision" }),
      P("CanQuery", "boolean", "Se a parte é considerada em raycasts/queries.", { category: "Collision" }),
      P("CollisionGroup", "string", "Grupo de colisão da parte (PhysicsService).", { category: "Collision" }),
      P("Position", "Vector3", "Posição da parte no mundo.", { category: "Transform" }),
      P("Rotation", "Vector3", "Rotação da parte em graus (X, Y, Z).", { category: "Transform" }),
      P("Orientation", "Vector3", "Orientação da parte em graus (Y, X, Z aplicados).", { category: "Transform" }),
      P("CFrame", "CFrame", "Posição e rotação completas da parte.", { category: "Transform" }),
      P("Size", "Vector3", "Dimensões da parte em studs.", { category: "Transform" }),
      P("Color", "Color3", "Cor da parte.", { category: "Appearance" }),
      P("BrickColor", "BrickColor", "Cor da parte na paleta clássica BrickColor.", { category: "Appearance" }),
      P("Material", "Enum.Material", "Material visual/físico da parte.", { category: "Appearance" }),
      P("Transparency", "number", "Transparência (0 = opaco, 1 = invisível).", { category: "Appearance" }),
      P("Reflectance", "number", "Reflexividade da superfície (0 = fosca, 1 = espelhada); clampada em 0..1. Parte 143.", { category: "Appearance" }),
      P("CastShadow", "boolean", "Se a parte projeta sombras.", { category: "Appearance" }),
      P("Mirror", "boolean", "Marca a Part como espelho planar real (IL-F23 do plano de iluminação). A face mais fina vira a superfície reflexiva; a normal aponta para o lado da câmera. Só tem efeito com Lighting.PlanarReflections AUTO ou true e GPU forte.", { category: "Appearance" }),
      P("Massless", "boolean", "Se true, não contribui para a massa do assembly.", { category: "Behavior" }),
      P("Locked", "boolean", "Impede seleção da parte no editor.", { category: "Behavior" }),
      P("AssemblyLinearVelocity", "Vector3", "Velocidade linear do assembly.", { category: "Assembly" }),
      P("AssemblyAngularVelocity", "Vector3", "Velocidade angular do assembly.", { category: "Assembly" }),
      P("Velocity", "Vector3", "Velocidade linear. Use AssemblyLinearVelocity.", { deprecated: true }),
      P("RotVelocity", "Vector3", "Velocidade angular. Use AssemblyAngularVelocity.", { deprecated: true }),
    ],
    m: [
      M("ApplyImpulse", [par("impulse", "Vector3")], "void", "Aplica um impulso linear instantâneo."),
      M("ApplyAngularImpulse", [par("impulse", "Vector3")], "void", "Aplica um impulso angular instantâneo."),
      M("GetTouchingParts", [], "{ BasePart }", "Partes atualmente em contato."),
      M("GetMass", [], "number", "Massa da parte: volume (pela forma) × densidade do Material. Parte 143."),
      M("Resize", [par("normalId", "Enum.NormalId"), par("delta", "number")], "boolean", "Cresce/encolhe a parte pela face indicada (desloca a posição em delta/2); false se violar o tamanho mínimo de 0.05. Parte 143."),
      M("BreakJoints", [], "void", "Remove todas as juntas (Weld, Snap, Motor6D, Glue...) conectadas à parte. Parte 143."),
      M("MakeJoints", [], "void", "Cria Welds com as partes encostadas cujas superfícies em contato são juntáveis (Weld, Glue, Studs, Inlet, Universal — Smooth não junta). Parte 143."),
      M("GetNetworkOwner", [], "Player", "Jogador dono da simulação de rede da parte, ou nil quando o dono é o servidor. Parte 143."),
      M("SetNetworkOwner", [par("player", "Player", true)], "void", "Define o dono de rede da parte (nil = servidor). Só no Server e apenas em parts não-Anchored. Parte 143."),
    ],
    e: [
      E("Touched", [par("otherPart", "BasePart")], "Disparado quando outra parte encosta nesta."),
      E("TouchEnded", [par("otherPart", "BasePart")], "Disparado quando o contato com outra parte termina."),
    ],
  }),
  Part: C("BasePart", "Parte primitiva (bloco, esfera, cilindro...).", {
    p: [P("Shape", "Enum.PartType", "Formato da parte (Block, Ball, Cylinder, Wedge...).", { category: "Appearance" })],
  }),
  MeshPart: C("BasePart", "Parte cuja geometria vem de uma malha (mesh).", {
    p: [
      P("MeshId", "string", "ID do asset da malha.", { readOnly: true }),
      P("TextureID", "string", "ID da textura aplicada à malha."),
    ],
  }),
  UnionOperation: C("BasePart", "Resultado de operações booleanas (CSG) entre partes.", {
    p: [P("UsePartColor", "boolean", "Usa a cor da parte em vez das cores originais.", { category: "Appearance" })],
  }),
  Model: C("PVInstance", "Contêiner para agrupar objetos 3D.", {
    p: [
      P("PrimaryPart", "BasePart", "BasePart principal do modelo (nil por padrão). Part destruída ou fora do modelo lê como nil. Parte 150.", { category: "Behavior" }),
      P("ModelStreamingMode", "Enum.ModelStreamingMode", "Como o modelo streama com StreamingEnabled: Default (por partes), Atomic (só completo), Persistent (nunca descarrega) ou PersistentPerPlayer. Parte 66.", { category: "Behavior" }),
    ],
    m: [
      M("AddPersistentPlayer", [par("player", "Player")], "void", "Torna o modelo persistente para o jogador (usar com ModelStreamingMode PersistentPerPlayer). Apenas no Server. Parte 66."),
      M("RemovePersistentPlayer", [par("player", "Player")], "void", "Remove a persistência do modelo para o jogador. Apenas no Server. Parte 66."),
      M("GetPersistentPlayers", [], "{ Player }", "Lista os jogadores para os quais o modelo é persistente. Parte 66."),
      M("MoveTo", [par("position", "Vector3")], "void", "Move o modelo para a posição (evitando sobreposição)."),
      M("GetBoundingBox", [], "(CFrame, Vector3)", "Caixa envolvente de todas as BaseParts do modelo: CFrame do centro (orientado pela PrimaryPart, se houver) e tamanho. Parte 150."),
      M("GetExtentsSize", [], "Vector3", "Tamanho da caixa envolvente das BaseParts do modelo (eixos da PrimaryPart, se houver). Parte 150."),
      M("SetPrimaryPartCFrame", [par("cframe", "CFrame")], "void", "Move o modelo rigidamente posicionando a PrimaryPart no CFrame (erro se PrimaryPart for nil). Deprecated: prefira PivotTo. Parte 150."),
      M("BreakJoints", [], "void", "Quebra todas as juntas (Weld, WeldConstraint, Motor6D, Snap, Rotate, Glue) ligadas às BaseParts do modelo. Parte 150."),
    ],
  }),

  ClimateService: C("Instance", "Serviço de clima ambiental: controla WeatherType, vento global e transições. Eventos: WeatherChanged(old, new) e WindChanged(oldWind, newWind).", {
    service: true,
    p: [
      P("WeatherType", "WeatherType", "Clima ativo: Clear, Cloudy, Rain, HeavyRain, Snow, Blizzard, Fog ou Sandstorm.", { category: "Behavior" }),
      P("Intensity", "number", "Intensidade do efeito climático (0 a 1).", { category: "Behavior" }),
      P("TransitionTime", "number", "Segundos para transitar entre climas (0 a 60, padrão 5).", { category: "Behavior" }),
      P("WindStrength", "number", "Força do vento global aplicada ao GlobalWind (0 a 100).", { category: "Behavior" }),
      P("WindDirection", "Vector3", "Direção normalizada do vento gerado pelo clima.", { category: "Behavior" }),
      P("TemperatureCelsius", "number", "Temperatura simulada, apenas informativa.", { category: "Data" }),
      P("AmbientSoundEnabled", "boolean", "Ativa sons ambientes de vento e chuva.", { category: "Behavior" }),
    ],
    m: [
      M("SetWeather", [par("weatherType", "string"), par("intensity", "number", true), par("transitionTime", "number", true)], "void", "Transiciona suavemente para o clima informado."),
      M("GetCurrentWeather", [], "string", "Retorna o WeatherType ativo."),
      M("GetWindVector", [], "Vector3", "Retorna o vetor de vento global atual."),
      M("StopWeather", [], "void", "Retorna o clima para Clear."),
    ],
  }),

  MemoryStoreService: C("Instance", "Armazenamento vol\u00e1til ultra-r\u00e1pido com TTL (n\u00e3o persiste ap\u00f3s o Stop). Apenas Server.", {
    service: true,
    m: [
      M("GetHashMap", [par("name", "string")], "MemoryStoreHashMap", "Mapa chave-valor com TTL (Set/Get/Update/Remove)."),
      M("GetSortedMap", [par("name", "string")], "MemoryStoreSortedMap", "Mapa ordenado com TTL e GetRangeAsync."),
      M("GetQueue", [par("name", "string"), par("invisibilityTimeout", "number", true)], "MemoryStoreQueue", "Fila com prioridade, TTL e invisibilidade ap\u00f3s leitura."),
    ],
  }),
  ReplicatedFirst: C("Instance", "Servi\u00e7o de replica\u00e7\u00e3o priorit\u00e1ria: LocalScripts aqui executam antes de todos os outros no Client.", {
    service: true,
    m: [
      M("RemoveDefaultLoadingScreen", [], "void", "Remove a tela de loading padr\u00e3o (simulado)."),
    ],
  }),
  InsertService: C("Instance", "Carrega assets por ID (simulado com geometria placeholder). Apenas Server.", {
    service: true,
    m: [
      M("LoadAsset", [par("assetId", "number")], "Model", "Retorna um Model placeholder para o asset (simulado)."),
    ],
  }),
  Chat: C("Instance", "Servi\u00e7o legado de chat. Prefira TextChatService.", {
    service: true,
    deprecated: true,
    m: [
      M("Chat", [par("partOrCharacter", "Instance"), par("message", "string"), par("color", "Enum.ChatColor", true)], "void", "Mostra uma mensagem de chat (simulado via Output)."),
      M("InternalClientGUI", [], "Instance?", "Placeholder legado (retorna nil).", { deprecated: true }),
    ],
  }),

  MarketplaceService: C("Instance", "Servi\u00e7o de monetiza\u00e7\u00e3o simulada: prompts de compra de Game Passes e Developer Products, informa\u00e7\u00f5es de produtos e o callback ProcessReceipt.", {
    service: true,
    m: [
      M("PromptGamePassPurchase", [par("player", "Player"), par("gamePassId", "number")], "void", "Abre o prompt de compra de um Game Pass para o jogador."),
      M("PromptProductPurchase", [par("player", "Player"), par("productId", "number")], "void", "Abre o prompt de compra de um Developer Product para o jogador."),
      M("PromptPurchase", [par("player", "Player"), par("assetId", "number")], "void", "Prompt gen\u00e9rico de compra de asset (simulado, sempre bem-sucedido)."),
      M("UserOwnsGamePassAsync", [par("userId", "number"), par("gamePassId", "number")], "boolean", "Se o usu\u00e1rio possui o Game Pass (dado autoritativo do Server/DataStore)."),
      M("GetProductInfo", [par("assetId", "number"), par("infoType", "Enum.InfoType", true)], "{ [string]: any }", "Informa\u00e7\u00f5es do item: Name, Description, PriceInRobux, IconImageAssetId, Created, Updated."),
      M("GetDeveloperProductsAsync", [], "Pages", "P\u00e1ginas com todos os Developer Products do jogo (GetCurrentPage / IsFinished)."),
    ],
    e: [
      E("PromptGamePassPurchaseFinished", [par("player", "Player"), par("gamePassId", "number"), par("wasPurchased", "boolean")], "Disparado quando o prompt de Game Pass \u00e9 conclu\u00eddo."),
      E("PromptProductPurchaseFinished", [par("player", "Player"), par("productId", "number"), par("wasPurchased", "boolean")], "Disparado quando o prompt de Developer Product \u00e9 conclu\u00eddo (legado, mantido por compatibilidade)."),
      E("PromptPurchaseFinished", [par("player", "Player"), par("assetId", "number"), par("wasPurchased", "boolean")], "Disparado quando o prompt gen\u00e9rico de asset \u00e9 conclu\u00eddo."),
    ],
    cb: [
      CB("ProcessReceipt", [par("receiptInfo", "{ [string]: any }")], "Enum.ProductPurchaseDecision", "Callback OBRIGAT\u00d3RIO no Server para conceder Developer Products. Receipt: PurchaseId, PlayerId, ProductId, CurrencySpent, CurrencyType. Retorne PurchaseGranted ap\u00f3s conceder; NotProcessedYet reprocessa automaticamente."),
    ],
  }),
  BadgeService: C("Instance", "Servi\u00e7o de badges simulado: concess\u00e3o e consulta de conquistas persistidas por jogador.", {
    service: true,
    m: [
      M("AwardBadge", [par("userId", "number"), par("badgeId", "number")], "boolean", "Concede o badge ao usu\u00e1rio (Server-only, idempotente). Retorna true apenas se concedeu agora."),
      M("UserHasBadgeAsync", [par("userId", "number"), par("badgeId", "number")], "boolean", "Se o usu\u00e1rio possui o badge."),
      M("GetBadgeInfoAsync", [par("badgeId", "number")], "{ [string]: any }", "Informa\u00e7\u00f5es do badge: Name, Description, IconImageId, IsEnabled."),
    ],
  }),
  GamePassService: C("Instance", "Servi\u00e7o legado de Game Passes. Obsoleto: use MarketplaceService.", {
    service: true,
    deprecated: true,
    m: [
      M("PlayerHasPass", [par("player", "Player"), par("gamePassId", "number")], "boolean", "Use MarketplaceService:UserOwnsGamePassAsync.", { deprecated: true }),
    ],
  }),
  Workspace: C("Model", "Serviço que contém todos os objetos 3D renderizados do jogo.", {
    service: true,
    p: [
      P("Gravity", "number", "Aceleração da gravidade (studs/s², padrão 196.2).", { category: "Behavior" }),
      P("FallenPartsDestroyHeight", "number", "Altura Y abaixo da qual BaseParts em queda (e personagens) são destruídos (padrão -500). Parte 148.", { category: "Behavior" }),
      P("GlobalWind", "Vector3", "Vento global (direção e força em studs/s, magnitude máxima 500). Parte 54.", { category: "Behavior" }),
      P("CurrentCamera", "Camera", "Câmera usada pelo jogador local."),
      P("Terrain", "Terrain", "Objeto Terrain do lugar.", { readOnly: true }),
      P("StreamingEnabled", "boolean", "Ativa o streaming do Workspace: cada Client carrega/descarrega o mundo dinamicamente ao redor do seu foco de replicação. Parte 66.", { category: "Behavior" }),
      P("StreamingMinRadius", "number", "Raio (studs) ao redor do foco sempre carregado no Client (padrão 64). Parte 66.", { category: "Behavior" }),
      P("StreamingTargetRadius", "number", "Raio-alvo (studs) de pré-carregamento ao redor do foco (padrão 256). Parte 66.", { category: "Behavior" }),
      P("StreamOutBehavior", "Enum.StreamOutBehavior", "Como o Client descarrega conteúdo: Default ou LowMemory (mais agressivo). Parte 66.", { category: "Behavior" }),
      P("ReplicationFocus", "Instance", "Foco de replicação padrão do Workspace (fallback quando o Player não tem foco/Character). Parte 66.", { category: "Behavior" }),
    ],
    m: [
      M("Raycast", [par("origin", "Vector3"), par("direction", "Vector3"), par("raycastParams", "RaycastParams", true)], "RaycastResult?", "Lança um raio e retorna o primeiro acerto."),
      M("GetPartBoundsInBox", [par("cframe", "CFrame"), par("size", "Vector3"), par("overlapParams", "OverlapParams", true)], "{ BasePart }", "Partes dentro de uma caixa."),
      M("GetPartBoundsInRadius", [par("position", "Vector3"), par("radius", "number"), par("overlapParams", "OverlapParams", true)], "{ BasePart }", "Partes dentro de uma esfera."),
      M("GetPartsInPart", [par("part", "BasePart"), par("overlapParams", "OverlapParams", true)], "{ BasePart }", "Partes que intersectam a parte dada."),
      M("Blockcast", [par("cframe", "CFrame"), par("size", "Vector3"), par("direction", "Vector3"), par("raycastParams", "RaycastParams", true)], "RaycastResult?", "Varre uma caixa pela direção e retorna o primeiro acerto."),
      M("Spherecast", [par("position", "Vector3"), par("radius", "number"), par("direction", "Vector3"), par("raycastParams", "RaycastParams", true)], "RaycastResult?", "Varre uma esfera pela direção e retorna o primeiro acerto."),
      M("Shapecast", [par("part", "BasePart"), par("direction", "Vector3"), par("raycastParams", "RaycastParams", true)], "RaycastResult?", "Varre a forma de uma parte pela direção e retorna o primeiro acerto."),
    ],
  }),
  Terrain: C("BasePart", "Terreno baseado em voxels do Workspace.", {
    p: [
      P("GrassLength", "number", "Altura visual da grama decorativa (0 a 4, padrão 0.4). Parte 54.", { category: "Appearance" }),
      P("WaterColor", "Color3", "Cor da água do terreno.", { category: "Water" }),
      P("WaterTransparency", "number", "Transparência da água (0 a 1).", { category: "Water" }),
      P("WaterWaveSize", "number", "Altura das ondas da água.", { category: "Water" }),
      P("WaterWaveSpeed", "number", "Velocidade das ondas da água.", { category: "Water" }),
    ],
    m: [
      M("FillBlock", [par("cframe", "CFrame"), par("size", "Vector3"), par("material", "Enum.Material")], "void", "Preenche uma caixa com material de terreno."),
      M("FillBall", [par("center", "Vector3"), par("radius", "number"), par("material", "Enum.Material")], "void", "Preenche uma esfera com material de terreno."),
      M("FillRegion", [par("region", "Region3"), par("resolution", "number"), par("material", "Enum.Material")], "void", "Preenche uma região com material."),
      M("Clear", [], "void", "Remove todo o terreno."),
    ],
  }),
  Camera: C("Instance", "Define o ponto de vista do jogador no mundo 3D.", {
    p: [
      P("CFrame", "CFrame", "Posição e orientação da câmera.", { category: "Transform" }),
      P("Focus", "CFrame", "Ponto de foco da câmera.", { category: "Transform" }),
      P("FieldOfView", "number", "Campo de visão vertical em graus."),
      P("CameraType", "Enum.CameraType", "Modo de comportamento da câmera."),
      P("CameraSubject", "Instance", "Objeto que a câmera segue (ex.: Humanoid)."),
      P("ViewportSize", "Vector2", "Tamanho do viewport em pixels.", { readOnly: true }),
      P("FieldOfViewMode", "Enum.FieldOfViewMode", "Como o FieldOfView \u00e9 interpretado (Vertical, Diagonal, MaxAxis)."),
      P("DiagonalFieldOfView", "number", "FOV diagonal derivado (leitura/escrita convertida)."),
      P("MaxAxisFieldOfView", "number", "FOV do maior eixo derivado (leitura/escrita convertida)."),
      P("NearPlaneZ", "number", "Dist\u00e2ncia do near plane.", { readOnly: true }),
      P("HeadLocked", "boolean", "Trava a c\u00e2mera \u00e0 cabe\u00e7a (VR, simulado)."),
      P("HeadScale", "number", "Escala de cabe\u00e7a (VR, simulado)."),
    ],
    m: [
      M("GetRenderCFrame", [], "CFrame", "CFrame real de renderiza\u00e7\u00e3o (inclui camera shake)."),
      M("WorldToScreenPoint", [par("worldPoint", "Vector3")], "(Vector3, boolean)", "Converte ponto 3D em coordenada de tela (com inset)."),
      M("WorldToViewportPoint", [par("worldPoint", "Vector3")], "(Vector3, boolean)", "Converte ponto 3D em coordenada do viewport."),
      M("ScreenPointToRay", [par("x", "number"), par("y", "number"), par("depth", "number", true, "0")], "Ray", "Raio partindo de um ponto da tela."),
      M("ViewportPointToRay", [par("x", "number"), par("y", "number"), par("depth", "number", true, "0")], "Ray", "Raio partindo de um ponto do viewport."),
      M("GetPartsObscuringTarget", [par("castPoints", "{ Vector3 }"), par("ignoreList", "{ Instance }", true)], "{ BasePart }", "Partes entre a c\u00e2mera e os pontos indicados."),
      M("ZoomToExtents", [par("boundingCFrame", "CFrame"), par("boundingSize", "Vector3")], "void", "Posiciona a c\u00e2mera para enquadrar um volume."),
      M("Interpolate", [par("targetCFrame", "CFrame"), par("targetFocus", "CFrame"), par("duration", "number")], "void", "Transi\u00e7\u00e3o suave legada: posi\u00e7\u00e3o em lerp e rota\u00e7\u00e3o em slerp; cancel\u00e1vel por nova chamada de Interpolate, escrita manual de CFrame ou troca de CameraType (cancelamento n\u00e3o dispara o evento); dispara InterpolationFinished ao terminar.", { deprecated: true }),
    ],
    e: [
      E("InterpolationFinished", [], "Disparado UMA vez quando um :Interpolate() legado termina naturalmente; interpola\u00e7\u00e3o cancelada N\u00c3O dispara."),
    ],
  }),


  DataModel: C("Instance", "Raiz da hierarquia do jogo (a variável global game).", {
    p: [
      P("Workspace", "Workspace", "O serviço Workspace.", { readOnly: true }),
      P("PlaceId", "number", "ID do place ativo no cloud local (0 se o projeto não foi publicado/vinculado). Semeado no início do playtest. Parte 148.", { readOnly: true }),
      P("GameId", "number", "ID do Universe (experiência) do place ativo (0 se não publicado). Parte 148.", { readOnly: true }),
      P("JobId", "string", "GUID único da sessão do servidor, novo a cada Play/Run (vazio no modo edição). Parte 148.", { readOnly: true }),
    ],
    m: [
      M("GetService", [par("className", "string")], "Instance", "Retorna o serviço pelo nome, criando-o se necessário."),
      M("FindService", [par("className", "string")], "Instance?", "Retorna o serviço se já existir, sem criar."),
      M("IsLoaded", [], "boolean", "true quando o load inicial do place terminou (no emulador: sempre true durante o playtest). Parte 148."),
      M("BindToClose", [par("callback", "function")], "void", "Registra um callback executado ao parar o servidor (Stop), antes do teardown. Apenas no Server; task.wait longos não são aguardados. Parte 148."),
    ],
    e: [E("Loaded", [], "Disparado quando o jogo termina de carregar.")],
  }),
  Players: C("Instance", "Serviço que gerencia os jogadores conectados.", {
    service: true,
    p: [
      P("LocalPlayer", "Player", "Jogador local (apenas em LocalScripts).", { readOnly: true }),
      P("MaxPlayers", "number", "Número máximo de jogadores.", { readOnly: true }),
      P("PreferredPlayers", "number", "Jogadores preferidos para matchmaking."),
      P("NumPlayers", "number", "Quantidade atual de jogadores conectados.", { readOnly: true }),
      P("BubbleChat", "boolean", "Liga o chat em balões acima dos personagens."),
      P("ClassicChat", "boolean", "Liga a janela de chat clássica."),
      P("RespawnTime", "number", "Segundos até o respawn automático do personagem."),
      P("CharacterAutoLoads", "boolean", "Se personagens nascem automaticamente."),
    ],
    m: [
      M("GetPlayers", [], "{ Player }", "Array com todos os jogadores conectados."),
      M("GetPlayerFromCharacter", [par("character", "Model")], "Player?", "Jogador dono do personagem dado."),
      M("GetPlayerByUserId", [par("userId", "number")], "Player?", "Jogador com o UserId dado."),
      M("GetUserIdFromNameAsync", [par("userName", "string")], "number", "UserId a partir do nome (simulado)."),
      M("GetNameFromUserIdAsync", [par("userId", "number")], "string", "Nome a partir do UserId (simulado)."),
      M("GetUserThumbnailAsync", [par("userId", "number"), par("thumbnailType", "Enum.ThumbnailType"), par("thumbnailSize", "Enum.ThumbnailSize")], "(string, boolean)", "URL do avatar e se está pronto (simulado)."),
      M("CreateHumanoidModelFromUserId", [par("userId", "number")], "Model", "Cria um rig placeholder com aparência genérica."),
      M("CreateHumanoidModelFromDescription", [par("description", "HumanoidDescription"), par("rigType", "Enum.HumanoidRigType")], "Model", "Cria um rig a partir de uma HumanoidDescription."),
    ],
    e: [
      E("PlayerAdded", [par("player", "Player")], "Disparado quando um jogador entra no jogo."),
      E("PlayerRemoving", [par("player", "Player")], "Disparado quando um jogador está saindo do jogo."),
      E("PlayerMembershipChanged", [par("player", "Player")], "Disparado quando a assinatura do jogador muda (placeholder)."),
    ],
  }),
  Player: C("Instance", "Representa um jogador conectado ao jogo.", {
    p: [
      P("Character", "Model", "Modelo do personagem do jogador no Workspace."),
      P("RespawnLocation", "SpawnLocation", "SpawnLocation usada no próximo respawn deste jogador (prioridade sobre a escolha automática; precisa estar habilitada e no Workspace). Parte 148."),
      P("UserId", "number", "ID único da conta do jogador.", { readOnly: true }),
      P("DisplayName", "string", "Nome de exibição do jogador.", { readOnly: true }),
      P("AccountAge", "number", "Dias desde a criação da conta (simulado).", { readOnly: true }),
      P("CharacterAppearanceId", "number", "ID de aparência do personagem (placeholder)."),
      P("CharacterAppearanceLoaded", "boolean", "Se a aparência do personagem já carregou.", { readOnly: true }),
      P("Team", "Team", "Time atual do jogador."),
      P("TeamColor", "BrickColor", "Cor do time do jogador."),
      P("Neutral", "boolean", "Se o jogador está sem time."),
      P("HealthDisplayDistance", "number", "Distância máxima para exibir a barra de vida."),
      P("NameDisplayDistance", "number", "Distância máxima para exibir o nome."),
      P("ChatMode", "Enum.ChatMode", "Modo de chat (Default, TextLabel, Menu)."),
      P("ReplicationFocus", "Instance", "Foco de replicação do jogador com StreamingEnabled: define ao redor de que parte o mundo streama para este Client (padrão: HumanoidRootPart do Character). Apenas o Server pode alterar. Parte 66."),
      P("AutoJumpEnabled", "boolean", "Pulo automático em dispositivos de toque."),
      P("CameraMode", "Enum.CameraMode", "Classic ou LockFirstPerson."),
      P("CameraMaxZoomDistance", "number", "Zoom máximo da câmera (studs)."),
      P("CameraMinZoomDistance", "number", "Zoom mínimo da câmera (studs)."),
      P("DevCameraOcclusionMode", "Enum.DevCameraOcclusionMode", "Como a câmera trata obstruções."),
      P("DevComputerCameraMode", "Enum.DevComputerCameraMode", "Modo de câmera no computador."),
      P("DevComputerMovementMode", "Enum.DevComputerMovementMode", "Modo de movimento no computador."),
      P("DevTouchCameraMode", "Enum.DevTouchCameraMode", "Modo de câmera no toque."),
      P("DevTouchMovementMode", "Enum.DevTouchMovementMode", "Modo de movimento no toque."),
      P("DevEnableMouseLock", "boolean", "Permite travar o mouse (shift lock)."),
      P("Backpack", "Instance", "Inventário (Tools) do jogador.", { readOnly: true }),
      P("PlayerGui", "PlayerGui", "Contêiner das ScreenGuis do jogador.", { readOnly: true }),
    ],
    m: [
      M("Kick", [par("message", "string", true)], "void", "Desconecta o jogador do servidor (apenas no servidor)."),
      M("LoadCharacter", [], "void", "Cria (ou recria) o personagem do jogador."),
      M("LoadCharacterWithHumanoidDescription", [par("description", "HumanoidDescription")], "void", "Spawna o personagem com aparência customizada."),
      M("RequestStreamAroundAsync", [par("position", "Vector3"), par("timeOut", "number", true)], "void", "Pede ao streaming para carregar a área ao redor da posição; yielda até a área mínima carregar ou o timeout (máx. 10s). Com rate limit por jogador. Parte 66."),
      M("AddReplicationFocus", [par("part", "BasePart")], "void", "Adiciona um foco de replicação extra para o jogador (apenas no Server). Parte 66."),
      M("RemoveReplicationFocus", [par("part", "BasePart")], "void", "Remove um foco de replicação extra do jogador (apenas no Server). Parte 66."),
      M("Move", [par("direction", "Vector3"), par("relativeToCamera", "boolean", true)], "void", "Move o personagem na direção dada."),
      M("DistanceFromCharacter", [par("point", "Vector3")], "number", "Distância entre a cabeça do personagem e o ponto."),
      M("GetMouse", [], "Mouse", "Mouse do jogador (apenas LocalScripts)."),
      M("GetJoinData", [], "table", "Dados de entrada do jogador (placeholder)."),
      M("IsFriendsWith", [par("userId", "number")], "boolean", "Se o jogador é amigo do UserId (simulado)."),
      M("GetFriendsOnline", [par("maxFriends", "number", true)], "{ table }", "Amigos online (simulado, vazio)."),
      M("HasAppearanceLoaded", [], "boolean", "Se a aparência do personagem já carregou."),
      M("GetRankInGroup", [par("groupId", "number")], "number", "Rank no grupo (simulado)."),
      M("GetRoleInGroup", [par("groupId", "number")], "string", "Cargo no grupo (simulado)."),
      M("IsInGroup", [par("groupId", "number")], "boolean", "Se o jogador está no grupo (simulado)."),
    ],
    e: [
      E("CharacterAdded", [par("character", "Model")], "Disparado quando o personagem nasce."),
      E("CharacterRemoving", [par("character", "Model")], "Disparado quando o personagem vai ser removido."),
      E("CharacterAppearanceLoaded", [par("character", "Model")], "Disparado quando a aparência do personagem carrega."),
      E("Chatted", [par("message", "string"), par("recipient", "Player", true)], "Disparado quando o jogador envia mensagem no chat."),
      E("Idled", [par("time", "number")], "Disparado quando o jogador fica inativo."),
      E("OnTeleport", [par("teleportState", "Enum.TeleportState"), par("placeId", "number"), par("spawnName", "string")], "Disparado em teleporte (placeholder)."),
    ],
  }),
  Teams: C("Instance", "Serviço que gerencia os times do jogo.", {
    service: true,
    m: [M("GetTeams", [], "{ Team }", "Array com todos os times.")],
  }),
  Team: C("Instance", "Representa um time de jogadores.", {
    p: [
      P("TeamColor", "BrickColor", "Cor que identifica o time (único)."),
      P("Score", "number", "Pontuação atual do time."),
      P("AutoAssignable", "boolean", "Se jogadores entram automaticamente neste time."),
      P("AutoColorCharacters", "boolean", "Se as Parts do personagem assumem a cor do time."),
    ],
    m: [M("GetPlayers", [], "{ Player }", "Jogadores que estão neste time.")],
    e: [
      E("PlayerAdded", [par("player", "Player")], "Disparado quando um jogador entra no time."),
      E("PlayerRemoved", [par("player", "Player")], "Disparado quando um jogador sai do time."),
    ],
  }),
  PlayerGui: C("Instance", "Contêiner das ScreenGuis específicas de um jogador.", {
    p: [
      P("CurrentScreenOrientation", "Enum.ScreenOrientation", "Orientação atual da tela.", { readOnly: true }),
      P("ScreenOrientation", "Enum.ScreenOrientation", "Orientação de tela desejada."),
      P("ShowDevelopmentGui", "boolean", "Mostra GUIs de desenvolvimento (placeholder)."),
      P("SelectionImageObject", "Instance", "Ícone de seleção em gamepad."),
    ],
    m: [
      M("GetTopbarTransparency", [], "number", "Transparência da barra superior (placeholder)."),
      M("SetTopbarTransparency", [par("transparency", "number")], "void", "Define a transparência da barra superior (placeholder)."),
    ],
  }),
  TextChatService: C("Instance", "Sistema moderno de chat por texto.", {
    service: true,
    p: [
      P("ChatVersion", "Enum.ChatVersion", "LegacyChatService ou TextChatService."),
      P("CreateDefaultCommands", "boolean", "Cria /team, /me e /help automaticamente."),
      P("CreateDefaultTextChannels", "boolean", "Cria RBXGeneral, RBXTeam, RBXWhisper e RBXSystem."),
    ],
    m: [M("SendAsync", [par("message", "string"), par("channel", "string", true)], "void", "Envia uma mensagem (canal opcional).")],
  }),
  TextChannel: C("Instance", "Canal de mensagens do TextChatService.", {
    p: [P("Name", "string", "Nome do canal.")],
    m: [
      M("SendAsync", [par("message", "string")], "void", "Envia mensagem neste canal."),
      M("DisplaySystemMessage", [par("message", "string")], "void", "Exibe uma mensagem de sistema no canal."),
    ],
    e: [
      E("MessageReceived", [par("textChatMessage", "table")], "Disparado quando uma mensagem chega no canal."),
      E("OnIncomingMessage", [par("textChatMessage", "table")], "Permite editar mensagens recebidas (placeholder)."),
      E("OnBubbleAdded", [par("textChatMessage", "table")], "Disparado quando um balão é adicionado."),
    ],
  }),
  TextChatCommand: C("Instance", "Comando de barra do TextChatService.", {
    p: [
      P("PrimaryAlias", "string", "Alias principal (ex: /team)."),
      P("SecondaryAlias", "string", "Alias secundário (ex: /t)."),
      P("Enabled", "boolean", "Se o comando está ativo."),
    ],
    e: [E("Triggered", [par("originTextSource", "Instance"), par("unfilteredText", "string")], "Disparado quando o comando é usado.")],
  }),


  LuaSourceContainer: C("Instance", "Classe base dos objetos que contêm código Luau.", {}),
  Script: C("LuaSourceContainer", "Código Luau executado no servidor.", {
    p: [
      P("Source", "string", "Código-fonte do script."),
      P("Enabled", "boolean", "Se o script executa."),
      P("Disabled", "boolean", "Use Enabled.", { deprecated: true }),
      P("RunContext", "Enum.RunContext", "Onde o script executa: Legacy (containers clássicos), Server (sempre no servidor, mesmo em storages), Client (no cliente, quando replicado) ou Plugin (não roda no Play). Parte 148."),
    ],
  }),
  LocalScript: C("Script", "Código Luau executado no cliente (jogador).", {}),
  ModuleScript: C("LuaSourceContainer", "Código reutilizável carregado com require(). Deve retornar exatamente um valor.", {
    p: [P("Source", "string", "Código-fonte do módulo.")],
  }),


  RemoteEvent: C("Instance", "Comunicação assíncrona entre servidor e cliente.", {
    m: [
      M("FireServer", [par("...", "any", true)], "void", "Cliente -> servidor: dispara OnServerEvent."),
      M("FireClient", [par("player", "Player"), par("...", "any", true)], "void", "Servidor -> um cliente: dispara OnClientEvent."),
      M("FireAllClients", [par("...", "any", true)], "void", "Servidor -> todos os clientes."),
    ],
    e: [
      E("OnServerEvent", [par("player", "Player"), par("...", "any")], "Recebido no servidor quando um cliente chama FireServer."),
      E("OnClientEvent", [par("...", "any")], "Recebido no cliente quando o servidor chama FireClient."),
    ],
  }),
  RemoteFunction: C("Instance", "Comunicação síncrona (com retorno) entre servidor e cliente.", {
    m: [
      M("InvokeServer", [par("...", "any", true)], "any", "Cliente -> servidor: chama OnServerInvoke e aguarda retorno."),
      M("InvokeClient", [par("player", "Player"), par("...", "any", true)], "any", "Servidor -> cliente: chama OnClientInvoke e aguarda retorno."),
    ],
    cb: [
      CB("OnServerInvoke", [par("player", "Player"), par("...", "any")], "any", "Função executada no servidor quando um cliente invoca."),
      CB("OnClientInvoke", [par("...", "any")], "any", "Função executada no cliente quando o servidor invoca."),
    ],
  }),
  BindableEvent: C("Instance", "Evento entre scripts do MESMO lado (server-server ou client-client).", {
    m: [M("Fire", [par("...", "any", true)], "void", "Dispara o evento Event.")],
    e: [E("Event", [par("...", "any")], "Disparado quando Fire é chamado.")],
  }),
  BindableFunction: C("Instance", "Função com retorno entre scripts do mesmo lado.", {
    m: [M("Invoke", [par("...", "any", true)], "any", "Chama OnInvoke e retorna o resultado.")],
    cb: [CB("OnInvoke", [par("...", "any")], "any", "Função executada quando Invoke é chamado.")],
  }),


  Animator: C("Instance", "Reproduz animacoes no rig e hospeda IKControls (Parte 52).", {
    p: [],
  }),

  IKControl: C("Instance", "Inverse Kinematics: faz uma cadeia de Bones/partes alcancar um alvo (Parte 52).", {
    p: [
      P("Enabled", "boolean", "Ativa/desativa o controle IK."),
      P("Type", "Enum.IKControlType", "Transform, Position, Rotation ou LookAt."),
      P("EndEffector", "Instance", "BasePart ou Bone que tenta alcancar o alvo."),
      P("Target", "Instance", "Alvo no mundo (BasePart ou Attachment)."),
      P("ChainRoot", "Instance", "Raiz da cadeia IK (ex.: ombro para a mao)."),
      P("Pole", "Instance", "Pole vector: controla a orientacao do cotovelo/joelho."),
      P("Priority", "number", "Prioridade entre IKControls do mesmo rig (-1000 a 1000)."),
      P("Weight", "number", "Blend 0..1 entre pose animada e IK."),
      P("SmoothTime", "number", "Suavizacao temporal em segundos (0 a 5)."),
      P("Offset", "CFrame", "Offset do EndEffector em relacao ao Target."),
    ],
  }),

  Humanoid: C("Instance", "Controla movimento, vida e animação de personagens.", {
    p: [
      P("AutoFootPlanting", "boolean", "Foot planting automatico dos pes (Parte 52)."),
      P("FootPlantingMaxOffset", "number", "Ajuste maximo dos pes em studs (padrao 1.5)."),
      P("Health", "number", "Vida atual do personagem."),
      P("MaxHealth", "number", "Vida máxima do personagem."),
      P("WalkSpeed", "number", "Velocidade de caminhada (studs/s, padrão 16)."),
      P("JumpPower", "number", "Força do pulo (quando UseJumpPower)."),
      P("JumpHeight", "number", "Altura do pulo em studs (quando UseJumpPower é false)."),
      P("UseJumpPower", "boolean", "Se true usa JumpPower; se false usa JumpHeight."),
      P("MaxSlopeAngle", "number", "Inclinação máxima que o personagem sobe (graus)."),
      P("HipHeight", "number", "Altura do quadril em relação ao chão."),
      P("AutoRotate", "boolean", "Se o personagem gira para a direção do movimento."),
      P("Jump", "boolean", "Define como true para fazer o personagem pular."),
      P("Sit", "boolean", "Se o personagem está sentado."),
      P("PlatformStand", "boolean", "Desativa o controle do personagem (boneco)."),
      P("WalkToPoint", "Vector3", "Destino atual de MoveTo."),
      P("WalkToPart", "BasePart", "Part de referência do MoveTo."),
      P("SeatPart", "BasePart", "Assento atual (nil se em pé).", { readOnly: true }),
      P("RigType", "Enum.HumanoidRigType", "Tipo do rig (R6 ou R15).", { readOnly: true }),
      P("AutomaticScalingEnabled", "boolean", "Aplica escalas do HumanoidDescription automaticamente."),
      P("RequiresNeck", "boolean", "Se o personagem morre ao perder a junta do pescoço."),
      P("BreakJointsOnDeath", "boolean", "Quebra as juntas do personagem ao morrer."),
      P("HealthDisplayDistance", "number", "Distância máxima para exibir a barra de vida."),
      P("HealthDisplayType", "Enum.HumanoidHealthDisplayType", "Quando exibir a barra de vida (AlwaysOn/AlwaysOff/DisplayWhenDamaged)."),
      P("NameDisplayDistance", "number", "Distância máxima para exibir o nome."),
      P("DisplayName", "string", "Nome exibido sobre o personagem."),
      P("MoveDirection", "Vector3", "Direção de movimento atual (unitária).", { readOnly: true }),
      P("FloorMaterial", "Enum.Material", "Material do chão sob os pés (Air no ar).", { readOnly: true }),
    ],
    m: [
      M("Move", [par("moveDirection", "Vector3"), par("relativeToCamera", "boolean", true, "false")], "void", "Move o personagem na direção dada."),
      M("MoveTo", [par("location", "Vector3"), par("part", "BasePart", true)], "void", "Caminha até a posição alvo."),
      M("TakeDamage", [par("amount", "number")], "void", "Aplica dano respeitando ForceFields."),
      M("GetState", [], "Enum.HumanoidStateType", "Estado físico atual do humanoid."),
      M("ChangeState", [par("state", "Enum.HumanoidStateType")], "void", "Força a troca de estado físico."),
      M("SetStateEnabled", [par("state", "Enum.HumanoidStateType"), par("enabled", "boolean")], "void", "Habilita/desabilita um estado físico."),
      M("GetStateEnabled", [par("state", "Enum.HumanoidStateType")], "boolean", "Se o estado físico está habilitado."),
      M("GetMoveVelocity", [], "Vector3", "Velocidade de movimento atual do personagem."),
      M("ApplyDescription", [par("description", "HumanoidDescription")], "void", "Aplica uma HumanoidDescription ao personagem."),
      M("EquipTool", [par("tool", "Tool")], "void", "Equipa uma Tool (placeholder — Tools chegam em parte futura)."),
      M("UnequipTools", [], "void", "Desequipa todas as Tools (placeholder)."),
      M("AddAccessory", [par("accessory", "Instance")], "void", "Anexa um acessório ao personagem."),
      M("LoadAnimation", [par("animation", "Animation")], "AnimationTrack", "Deprecated: delega ao Animator filho (use Animator:LoadAnimation)."),
    ],
    e: [
      E("Died", [], "Disparado quando o personagem morre."),
      E("Running", [par("speed", "number")], "Disparado enquanto corre (com a velocidade)."),
      E("Jumping", [par("active", "boolean")], "Disparado ao pular."),
      E("FreeFalling", [par("active", "boolean")], "Disparado em queda livre."),
      E("Landed", [], "Disparado ao aterrissar após uma queda."),
      E("Swimming", [par("speed", "number")], "Disparado enquanto nada (com a velocidade)."),
      E("Seated", [par("active", "boolean"), par("currentSeatPart", "BasePart")], "Disparado ao sentar/levantar."),
      E("StateChanged", [par("old", "Enum.HumanoidStateType"), par("new", "Enum.HumanoidStateType")], "Disparado quando o estado físico muda."),
      E("HealthChanged", [par("health", "number")], "Disparado quando a vida muda."),
      E("MoveToFinished", [par("reached", "boolean")], "Disparado quando MoveTo termina."),
      E("Touched", [par("touchingPart", "BasePart"), par("humanoidPart", "BasePart")], "Disparado quando o personagem encosta em algo."),
    ],
  }),
  SpawnLocation: C("BasePart", "Ponto de spawn dos personagens (Parte 35).", {
    p: [
      P("Enabled", "boolean", "Se este spawn está ativo para respawns."),
      P("Neutral", "boolean", "Se aceita jogadores de qualquer time."),
      P("TeamColor", "BrickColor", "Time associado ao spawn."),
      P("Duration", "number", "Duração do ForceField criado ao spawnar (s)."),
      P("AllowTeamChangeOnTouch", "boolean", "Troca o time do jogador ao tocar."),
    ],
  }),
  TrussPart: C("BasePart", "Viga metálica escalável pelo personagem (Climbing).", {}),
  ForceField: C("Instance", "Protege o personagem contra TakeDamage enquanto ativo.", {
    p: [P("Visible", "boolean", "Se o efeito visual é exibido.")],
  }),
  Accoutrement: C("Instance", "Base legada dos acessorios equipaveis no corpo (Parte 53).", {
    p: [],
  }),
  Accessory: C("Accoutrement", "Container de item equipavel: precisa de um Handle com Attachment compativel (Parte 53).", {
    p: [
      P("AccessoryType", "Enum.AccessoryType", "Categoria do acessorio (Hat, Hair, Shirt, Pants...)."),
    ],
  }),
  Tool: C("Model", "Item equipavel segurado pelo personagem; o Handle e a part segurada (Parte 39; Grip CFrame completo na Parte 140).", {
    p: [
      P("Grip", "CFrame", "Pega da Tool como CFrame completo (posicao + orientacao). Lido dos 4 vetores GripPos/GripForward/GripRight/GripUp; atribuir um CFrame decompoe e grava os 4 (Parte 140)."),
      P("GripPos", "Vector3", "Componente de posicao da pega (origem do Grip)."),
      P("GripForward", "Vector3", "Eixo -Z da pega: direcao para onde a Tool aponta ao ser segurada."),
      P("GripRight", "Vector3", "Eixo X da pega."),
      P("GripUp", "Vector3", "Eixo Y da pega."),
    ],
  }),
  WrapTarget: C("Instance", "Cage do corpo que recebe layered clothing; fica dentro da MeshPart/Part do corpo (Parte 53).", {
    p: [
      P("CageMeshId", "string", "Asset ID da cage mesh alvo."),
      P("CageOrigin", "CFrame", "Origem da cage."),
      P("ImportOrigin", "CFrame", "CFrame usado no momento da importacao."),
      P("Stiffness", "number", "Rigidez visual da superficie (0 a 1)."),
      P("Color", "Color3", "Cor de debug da cage no editor."),
    ],
  }),
  WrapLayer: C("Instance", "Descreve como uma roupa em camadas se deforma sobre o corpo; fica dentro do Handle (Parte 53).", {
    p: [
      P("CageMeshId", "string", "Asset ID da cage da roupa."),
      P("CageOrigin", "CFrame", "Origem da cage da roupa."),
      P("ImportOrigin", "CFrame", "CFrame de importacao."),
      P("Order", "number", "Ordem de sobreposicao entre camadas."),
      P("Puffiness", "number", "Afastamento da roupa em relacao ao corpo."),
      P("ReferenceMeshId", "string", "Asset ID da mesh de referencia."),
      P("ReferenceOrigin", "CFrame", "CFrame da referencia."),
      P("BindOffset", "CFrame", "Offset de binding aplicado ao wrap."),
      P("Enabled", "boolean", "Se false, o Accessory renderiza como mesh rigida."),
    ],
  }),
  HumanoidDescription: C("Instance", "Descreve a aparência de um Humanoid.", {
    p: [
      P("HeadColor", "Color3", "Cor da cabeça."),
      P("TorsoColor", "Color3", "Cor do torso."),
      P("LeftArmColor", "Color3", "Cor do braço esquerdo."),
      P("RightArmColor", "Color3", "Cor do braço direito."),
      P("LeftLegColor", "Color3", "Cor da perna esquerda."),
      P("RightLegColor", "Color3", "Cor da perna direita."),
      P("HeadScale", "number", "Escala da cabeça."),
      P("HeightScale", "number", "Escala de altura do corpo (aplicada por ApplyDescription)."),
      P("WidthScale", "number", "Escala de largura/profundidade do corpo (aplicada por ApplyDescription)."),
      P("HatAccessory", "number", "Asset ID do chapeu (Parte 53)."),
      P("HairAccessory", "number", "Asset ID do cabelo (Parte 53)."),
      P("FaceAccessory", "number", "Asset ID do acessorio de rosto (Parte 53)."),
      P("NeckAccessory", "number", "Asset ID do acessorio de pescoco (Parte 53)."),
      P("ShouldersAccessory", "number", "Asset ID do acessorio de ombro (Parte 53)."),
      P("FrontAccessory", "number", "Asset ID do acessorio frontal (Parte 53)."),
      P("BackAccessory", "number", "Asset ID do acessorio de costas (Parte 53)."),
      P("WaistAccessory", "number", "Asset ID do acessorio de cintura (Parte 53)."),
      P("Shirt", "number", "Asset ID da camisa layered (Parte 53)."),
      P("Pants", "number", "Asset ID da calca layered (Parte 53)."),
      P("GraphicTShirt", "number", "Asset ID da t-shirt layered (Parte 53)."),
      P("JacketAccessory", "number", "Asset ID da jaqueta layered (Parte 53)."),
      P("SweaterAccessory", "number", "Asset ID do sueter layered (Parte 53)."),
      P("ShortsAccessory", "number", "Asset ID do shorts layered (Parte 53)."),
      P("LeftShoeAccessory", "number", "Asset ID do sapato esquerdo (Parte 53)."),
      P("RightShoeAccessory", "number", "Asset ID do sapato direito (Parte 53)."),
      P("DressSkirtAccessory", "number", "Asset ID da saia layered (Parte 53)."),
    ],
  }),
  Animation: C("Instance", "Referência a um asset de animação.", {
    p: [P("AnimationId", "string", "ID do asset da animação (rbxassetid://...).")],
  }),
  AnimationTrack: C("Instance", "Instância de uma animação carregada em um Animator.", {
    p: [
      P("IsPlaying", "boolean", "Se a animação está tocando.", { readOnly: true }),
      P("Length", "number", "Duração da animação em segundos.", { readOnly: true }),
      P("Looped", "boolean", "Se a animação repete em loop."),
      P("Priority", "Enum.AnimationPriority", "Prioridade de mistura da animação."),
      P("Speed", "number", "Multiplicador de velocidade de reprodução.", { readOnly: true }),
      P("TimePosition", "number", "Posição atual de reprodução em segundos."),
      P("WeightCurrent", "number", "Peso atual de mistura (rampa linear do crossfade).", { readOnly: true }),
      P("WeightTarget", "number", "Peso alvo da rampa em curso (Play/Stop/AdjustWeight).", { readOnly: true }),
    ],
    m: [
      M("Play", [par("fadeTime", "number", true, "0.1"), par("weight", "number", true, "1"), par("speed", "number", true, "1")], "void", "Toca a animação; o peso sobe em rampa linear até 'weight' em 'fadeTime' s."),
      M("Stop", [par("fadeTime", "number", true, "0.1")], "void", "Para com fade-out real: Stopped é imediato e Ended sai quando o peso zera."),
      M("AdjustSpeed", [par("speed", "number")], "void", "Altera a velocidade durante a reprodução."),
      M("AdjustWeight", [par("weight", "number"), par("fadeTime", "number", true)], "void", "Altera o peso em rampa de 'fadeTime' s (padrão 0.1; ignorado durante fade-out)."),
      M("GetTimeOfKeyframe", [par("keyframeName", "string")], "number", "Tempo do keyframe com o nome dado."),
    ],
    e: [
      E("Stopped", [], "Disparado quando a animação para."),
      E("Ended", [], "Disparado no tick em que o fade-out zera o peso (WeightCurrent = 0)."),
      E("KeyframeReached", [par("keyframeName", "string")], "Disparado ao atingir um keyframe nomeado."),
      E("DidLoop", [], "Disparado a cada repetição do loop."),
    ],
  }),
  Animator: C("Instance", "Reproduz animações em um Humanoid ou AnimationController.", {
    m: [
      M("LoadAnimation", [par("animation", "Animation")], "AnimationTrack", "Carrega uma Animation e devolve a AnimationTrack correspondente."),
      M("GetPlayingAnimationTracks", [], "table", "Lista as AnimationTracks tocando neste Animator."),
    ],
    e: [E("AnimationPlayed", [par("animationTrack", "AnimationTrack")], "Disparado quando uma track começa a tocar via Play.")],
  }),


  Sound: C("Instance", "Reproduz um arquivo de áudio.", {
    p: [
      P("SoundId", "string", "ID do asset de áudio (rbxassetid://...)."),
      P("Playing", "boolean", "Se o som está tocando (replicada)."),
      P("IsPlaying", "boolean", "True enquanto o som está tocando.", { readOnly: true }),
      P("IsLoaded", "boolean", "True quando o asset terminou de carregar.", { readOnly: true }),
      P("Looped", "boolean", "Se o som repete em loop."),
      P("Volume", "number", "Volume (0 a 10, padrão 0.5)."),
      P("PlaybackSpeed", "number", "Velocidade de reprodução (afeta o pitch)."),
      P("Pitch", "number", "Use PlaybackSpeed.", { deprecated: true }),
      P("TimePosition", "number", "Posição atual de reprodução em segundos."),
      P("TimeLength", "number", "Duração total do som em segundos.", { readOnly: true }),
      P("RollOffMinDistance", "number", "Distância onde o som começa a atenuar (3D)."),
      P("RollOffMaxDistance", "number", "Distância onde o som fica inaudível (3D)."),
      P("RollOffMode", "Enum.RollOffMode", "Curva de atenuação 3D."),
      P("SoundGroup", "SoundGroup", "Grupo de mixagem do som."),
    ],
    m: [
      M("Play", [], "void", "Toca o som desde TimePosition."),
      M("Stop", [], "void", "Para e reseta TimePosition para 0."),
      M("Pause", [], "void", "Pausa mantendo TimePosition."),
      M("Resume", [], "void", "Retoma de onde pausou."),
    ],
    e: [
      E("Played", [par("soundId", "string")], "Disparado quando Play é chamado."),
      E("Stopped", [par("soundId", "string")], "Disparado quando Stop é chamado."),
      E("Paused", [par("soundId", "string")], "Disparado quando Pause é chamado."),
      E("Resumed", [par("soundId", "string")], "Disparado quando Resume é chamado."),
      E("Ended", [par("soundId", "string")], "Disparado quando o som termina naturalmente."),
      E("Loaded", [par("soundId", "string")], "Disparado quando o asset termina de carregar."),
      E("DidLoop", [par("soundId", "string"), par("numOfTimesLooped", "number")], "Disparado a cada volta completa quando Looped = true (Parte 149)."),
    ],
  }),
  SoundService: C("Instance", "Serviço de configuração global de áudio.", {
    service: true,
    p: [
      P("AmbientReverb", "Enum.ReverbType", "Reverberação ambiente global."),
      P("RespectFilteringEnabled", "boolean", "Se sons de clientes replicam."),
    ],
    m: [
      M("PlayLocalSound", [par("sound", "Sound")], "void", "Toca um Sound localmente em 2D, sem espacialização, onde quer que ele esteja (Parte 149)."),
    ],
  }),
  SoundGroup: C("Instance", "Grupo de mixagem com volume e efeitos compartilhados.", {
    p: [P("Volume", "number", "Multiplicador de volume do grupo.")],
  }),
  SoundEffect: C("Instance", "Base dos efeitos aplicáveis a Sound/SoundGroup.", {
    p: [
      P("Enabled", "boolean", "Se o efeito está ativo."),
      P("Priority", "number", "Ordem de aplicação entre efeitos."),
    ],
  }),
  ReverbSoundEffect: C("SoundEffect", "Efeito de reverberação.", {
    p: [
      P("DecayTime", "number", "Tempo de decaimento do reverb (s)."),
      P("Density", "number", "Densidade das reflexões (0 a 1)."),
      P("Diffusion", "number", "Difusão das reflexões (0 a 1)."),
      P("DryLevel", "number", "Nível do sinal original (dB)."),
      P("WetLevel", "number", "Nível do sinal processado (dB)."),
    ],
  }),
  EqualizerSoundEffect: C("SoundEffect", "Equalizador de três bandas.", {
    p: [
      P("LowGain", "number", "Ganho dos graves (dB)."),
      P("MidGain", "number", "Ganho dos médios (dB)."),
      P("HighGain", "number", "Ganho dos agudos (dB)."),
    ],
  }),


  Lighting: C("Instance", "Serviço que controla a iluminação global e o céu.", {
    service: true,
    p: [
      P("SubstrateEnabled", "boolean?", SUBSTRATE_PUBLIC_API.SubstrateEnabled.description, { category: "Lighting" }),
      P("SubstrateSM", SSM_PUBLIC_API.SubstrateSM.type, SSM_PUBLIC_API.SubstrateSM.description, { category: "Lighting" }),
      P("SubstrateSMQuality", SSM_PUBLIC_API.SubstrateSMQuality.type, SSM_PUBLIC_API.SubstrateSMQuality.description, { category: "Lighting" }),
      P("CinematicPostProcess", "boolean?", "Pós-processo cinematográfico (pacote CP-F01..F36) como base do Future. Tri-state: nil/ausente = auto (liga na Technology Future fora do modo seguro); true força o pedido; false mantém o pós legado. Sem efeito em Classic/ShadowMap/Voxel.", { category: "Lighting" }),
      P("MegaLightsSM", "boolean?", MSM_PUBLIC_API.MegaLightsSM.description, { category: "Lighting" }),
      P("MegaLightsSMMode", "string", MSM_PUBLIC_API.MegaLightsSMMode.description, { category: "Lighting" }),
      P("MegaLightsSMStrength", "number", MSM_PUBLIC_API.MegaLightsSMStrength.description, { category: "Lighting" }),
      P("MegaLightsSMView", "string", MSM_PUBLIC_API.MegaLightsSMView.description, { category: "Lighting" }),
      P("Ambient", "Color3", "Cor da luz ambiente em interiores."),
      P("OutdoorAmbient", "Color3", "Cor da luz ambiente em exteriores."),
      P("Brightness", "number", "Intensidade da luz do sol."),
      P("ClockTime", "number", "Hora do dia (0 a 24)."),
      P("TimeOfDay", "string", "Hora do dia como string (HH:MM:SS)."),
      P("GeographicLatitude", "number", "Latitude que afeta a trajetória do sol."),
      P("FogColor", "Color3", "Cor da névoa clássica."),
      P("FogStart", "number", "Distância onde a névoa começa."),
      P("FogEnd", "number", "Distância onde a névoa é total."),
      P("GlobalShadows", "boolean", "Se sombras globais são renderizadas."),
      P("AmbientOcclusion", "boolean", "Oclusão ambiente em screen-space (GTAO); efetiva na Technology Future."),
      P("AmbientOcclusionLite", "boolean", "GTAO-lite a ¼ de resolução para GPU fraca (F10 do plano de sombras em GPU fraca); efetivo na Technology Future quando o perfil fraco está no tier low. F24: tri-state — nil/ausente = auto (liga sozinho na GPU fraca com Future+GlobalShadows); true/false explícito manda; GPU forte segue opt-in."),
      P("FeatureBudget", "boolean", "Governor 'mosaico' por feature para GPU fraca (F19 do plano de sombras em GPU fraca): compra CSM/AO/SSCS/far/vidro/GI-extra/RT-ócio pelo orçamento de ms por frame (ledger F1), vende sob pressão e tem kill-switch anti-TDR; efetivo na Technology Future do perfil fraco. F24: tri-state — nil/ausente = auto (liga sozinho na GPU fraca com Future+GlobalShadows); true/false explícito manda; GPU forte segue sem efeito."),
      P("CsmRodizio", "boolean", "CSM 4 cascatas em rodízio para GPU fraca (F6 do plano de sombras em GPU fraca): cascata 0 quente (512–768 px) + fantasmas em round-robin reusando o cache de páginas (VSM); exige >=16 texture units. F24: tri-state — nil/ausente = auto (liga sozinho na GPU fraca com Future+GlobalShadows); true/false explícito manda; GPU forte nunca entra."),
      P("ContactShadows", "boolean", "Sombras de contato em screen-space (base dos objetos); efetivas na Technology Future."),
      P("RayTracedShadows", "boolean", "Sombras do sol por ray tracing progressivo (screen-space mask, refina no ócio); Technology Future + GlobalShadows."),
      P("HalfResSunShadows", "boolean", "Sombra do sol PCSS em meia resolução com acumulação temporal (F5 do plano de sombras em GPU fraca); efetiva na Technology Future com PCSS ativo (RayTracedShadows ligado tem prioridade). F24: tri-state — nil/ausente = auto (liga sozinho na GPU fraca com Future+GlobalShadows); true/false explícito manda; GPU forte segue opt-in."),
      P("ShadowMapPlus", "boolean", "Qualidade mínima do tech ShadowMap (F38): penumbra do PCF dinâmica pela elevação do sol (a pino firme, entardecer suave), janela do mapa com texel-alvo (~0,35 stud) e luzes locais com borda suave. Tri-state — nil/ausente = auto (liga só na Technology ShadowMap, em qualquer GPU); true/false explícito manda; Voxel/Future seguem intactos."),
      P("ShadowAtlas", "boolean", "F14 do roadmap de sombras: atlas físico único para mapas de sombra de SpotLights (4096²/8192²; slots LRU por prioridade; subida/descida de resolução SEM recriar textura; MegaLights real com reservoir K=2–4 amostras/pixel + validação de visibilidade real no atlas + transmissão colorida integrada). Tri-state — nil/ausente = AUTO (liga na GPU forte com Technology Future + MegaLights ativos); true força; false mantém caminho avulso legado. GPU fraca mantém caminho atual (OFF é aceite da fase). Residuais declarados: point/cubemap por último."),
      P("LightCluster", "boolean", "IL-F28 do plano de iluminação: clustered/tiled light culling (grade 16×9×24 em view space, Z-binning logarítmico). CPU monta buffers DataTexture por frame — custo estável com centenas de luzes iluminando. Estende o MegaLights com peso especular GGX-aproximado (boost d^1.5 em vez de d^2), revelando reflexos de luzes distantes nos metais. Tri-state: nil/ausente = AUTO (liga com Technology Future + MegaLights ativos + GPU forte); true força; false veta. GPU fraca mantém caminho atual (OFF é aceite da fase)."),
      P("AreaLightParts", "boolean", "IL-F37 do plano de iluminação: área lights (RectLight/TubeLight) iluminam também os pools de parts primitivas (Phong no Future) via aproximação MRP/LTC-lite uniform-driven — softbox gera highlight retangular em chão de Parts. Tri-state: nil/ausente = AUTO (RenderStyle Realistic + Technology Future + GPU forte); true força; false veta. GPU fraca VETA sempre (OFF é aceite da fase)."),
      P("VolumetricFog", "boolean", "Fog volumétrico raymarched (IL-F18 do plano de iluminação): god rays 3D com oclusão pelas sombras do sol (cascatas lidas read-only), densidade derivada do Atmosphere e até 4 luzes locais com brilho volumétrico analítico. Tri-state — nil/ausente = auto (liga só na GPU forte com Technology Future + GlobalShadows); true força; false desliga. No perfil fraco o fallback continua sendo o SunRaysEffect."),
      P("SunClipmap", "boolean", "Fase 12 (SOMBRAS-VS-UE58-ROADMAP.md): modo clipmap virtual do sol — resolução VIRTUAL constante do contato ao horizonte (8 níveis concêntricos, meio-lado dobrando por nível, atlas físico único 4096²). Fatia A ativa o planejador CPU com telemetria. Fatia B (render por página) e fatia C (amostragem GLSL) são residuais. Tri-state: nil/ausente = AUTO-off na fatia A; true = opt-in explícito; false = veto. Exige Lighting.VirtualShadows = true, Technology Future, GPU forte e tier medium+."),
      P("SSR", "boolean", "Reflexos screen-space (IL-F21 do plano de iluminação): piso molhado/espelho d'água refletem a cena em movimento — marcha ½ res com refino binário + acumulação temporal (mesmo contrato de história), roughness-aware (mip do RT de cena), fades de borda/backface e Fresnel, compostos ANTES do tonemap. Tri-state — nil/ausente = auto (liga só na GPU forte com Technology Future + RenderStyle Realistic; OFF no perfil fraco é aceite da fase); true força; false desliga. Sem G-buffer: normal reconstruída do depth (cantos são o residual documentado)."),
      P("GlassRefraction", "boolean", "Refração REAL de vidro (IL-F12 do plano de iluminação): Glass/Ice/Glacier mostram a cena atrás deles de verdade — grab-pass compartilhado em meia resolução com mips (roughness de transmissão: Glass nítido, Ice fosco, Glacier mais fosco), Fresnel físico por IOR e absorção Beer-Lambert. Tri-state — nil/ausente = auto (liga onde suportado; desliga no tier micro da GPU fraca e na Technology Compatibility); false volta ao caminho clássico por opacidade; true força onde suportado."),
      P("IndexOfRefraction", "number", "Índice de refração do material Glass (IL-F12). 1.0 = sem desvio; 1.52 = vidro crown (padrão). Ice/Glacier usam presets físicos próprios. Clamp efetivo [1, 3]; ao vivo, sem recompilar shader."),
      P("MaterialFeatures", "boolean", "IL-F11: lobos físicos de material no estilo Realistic — clearcoat (plástico polido/mármore), anisotropia (metais escovados), sheen (tecidos) e SSS-lite (grama/couro/neve/gelo) via uniforms num único shader patchado (zero variantes de programa). Tri-state: vazio = AUTO (liga com RenderStyle 'Realistic' fora do perfil de GPU fraca); true força em qualquer GPU; false desliga. Em Classic nada muda (byte a byte)."),
      P("RenderStyle", "string", "Interruptor MESTRE do plano de iluminação realista: 'Classic' (default) preserva o visual atual byte a byte; 'Realistic' liga o realismo por fases atrás de um único gate — IL-F2: cadeia do pós em half-float com ColorCorrection sem o teto 0..4 (clamp 65504); IL-F4: fotometria física (sol/céu/lua em lux normalizados por EV100 — meio-dia EV~15, noite EV~-2; Brightness vira stops fotográficos, 2 = neutro; ExposureCompensation em stops reais); IL-F7: tabela física dos 38 materiais por valor; IL-F13: emissivos HDR em nits reais; IL-F14: céu físico. No perfil de GPU FRACA com Technology=ShadowMap, 'Realistic' liga o pacote SM-Realista Lite (F1–F5 do PLANO-REALISMO-SM): Blinn-Phong por pixel, GTAO-lite 1/4 fixo + specular occlusion, PCSS-lite do sol (8 taps), IBL-lite 32 px e pós leve (flare-lite/vinheta/grading) — tudo FIXO por modo (nunca f(fps)), alvo 25–35 fps no G210, QA tri-state window.__rswSmRealista (true força / false veta / ausente AUTO) e certificação F6 via tools/qa/iluminacao/sm-lite-f6-certificacao.qa.js; Classic e GPU forte seguem byte a byte."),
      P("EnvironmentDiffuseScale", "number", "Contribuição difusa do ambiente."),
      P("EnvironmentSpecularScale", "number", "Contribuição especular do ambiente."),
      P("ExposureCompensation", "number", "Compensação de exposição da cena."),
  P("AutoExposure", "boolean", "Adaptação ocular (IL-F5): mede a luminância da cena na GPU (cadeia de reduções + leitura assíncrona, ~1 frame de atraso, sem stall) e adapta a exposição com velocidades separadas (clarear 5 EV/s, escurecer 2,5 EV/s) e histerese anti-pumping (deadband 0,35 EV). ExposureCompensation segue valendo como offset manual por cima. Tri-state: nil = AUTO (hoje OFF — paridade Classic; reservado ao futuro RenderStyle Realistic), true = força ligar (exceto tier micro do perfil fraco e WebGL1), false = desliga."),
        P("LocalExposure", "boolean", "IL-F6: exposição local (contraste local estilo UE) — clareia sombras e recupera estouros POR REGIÃO da tela sem lavar o contraste global. true liga (fora do perfil de GPU fraca); false desliga; ausente/null = AUTO, segue RenderStyle ('Realistic' liga). Custo: 3 blits em ¼ de resolução dentro do pass de pós."),
        P("LocalExposureStrength", "number", "IL-F6: força da exposição local (0–1, default 0.35). 0 desliga (não paga o pass); teto do ganho ±2 stops por região (anti-halo pelo guia bilateral)."),
        P("LensFlare", "boolean", "IL-F30: lens flare físico — ghosts por espelhamento do bright-pass (1/8 de resolução, energia conservada: pesos somam 1), halo anamórfico e starburst ancorado no sol, TUDO mascarado pela oclusão REAL do disco solar (depth compartilhado; sol tampado ⇒ flare some — não é sprite). true liga (perfil de GPU fraca VETA, salvo com o pacote SM-Realista Lite ativo — F5 do plano REALISMO-SM: no fraco o flare roda em modo LITE com 3 ghosts na mesma cadeia 1/8 e energia conservada, e o modo foto volta à tabela cheia); false desliga; ausente/null = AUTO, segue RenderStyle ('Realistic' liga). Custo: 3 blits em ≤1/8 de resolução + 1 composite; OFF ⇒ pass fora da chain (paridade byte a byte)."),
        P("LensFlareIntensity", "number", "IL-F30: intensidade do lens flare (0–1, default 0.35 = discreto). 0 desliga (o pass sai da chain); a energia dos ghosts é conservada (soma dos pesos = 1), então subir a intensidade não 'inventa' luz — só escala o que o bright-pass capturou."),
      P("LightPhotometry", "boolean", "IL-F27: fotometria REAL das luzes locais — Brightness em lúmens (800 lm/unidade), candela pela abertura do cone, falloff 1/d² físico (janela suave por Range mantida) e Kelvin (Temperature/LightPreset) com cores de vida real (sódio×LED×vela sem tint manual). null/ausente = AUTO (segue RenderStyle 'Realistic'); true força (até no Classic); false veta. Intensidades coerentes com o EV100 da cena (IL-F4): a mesma lâmpada some ao meio-dia e domina à noite."),
      P("ToneMapper", "string", "Curva de tone mapping do pass final (IL-F3): Legacy (padrão, sRGB direto byte a byte com o visual clássico), AgX (rolloff fílmico recomendado — highlights e cores extremas sem clip), ACES (fit de Hill, look clássico de cinema) ou PBRNeutral (Khronos, cores fiéis ao material). Aplicada DEPOIS do ColorCorrection/grade e ANTES da conversão sRGB."),
      P("ColorGradingPreset", "string", "IL-F31: preset de color grading bakeado em LUT 33³ pelo gradingCore — None (padrão, byte a byte), FilmicCool (azul-frio, rolloff fílmico), Golden (âmbar quente) ou Noir (dessaturado cinemático). Aplicado POR ÚLTIMO, após a conversão sRGB (espaço de display, como LUTs .cube são autoradas). LUT .cube explícita via __rswGrading.setLutText() tem prioridade."),
      P("WhiteBalanceTemperature", "number", "IL-F31: temperatura de cor do white balance (1500–15000 K, default 6500). Aplicada PRÉ-tonemap (linear da cena) por matriz Bradford D65. 6500 K = neutro (identidade exata; off); < 6500 esfria (azulado); > 6500 esquenta (âmbar). Pair com WhiteBalanceTint."),
      P("WhiteBalanceTint", "number", "IL-F31: tint do white balance (-1..1, default 0). Offset perpendicular ao locus planckiano em CIE 1960: > 0 puxa magenta, < 0 puxa verde. Aplicado junto com WhiteBalanceTemperature, PRÉ-tonemap."),
      P("ColorGradingLutAmount", "number", "IL-F31: dose da LUT de color grading (0–1, default 1). 0 desliga o ramo da LUT (zero custo); 1 aplica 100% da LUT (preset ou .cube). Interpola entre o sinal sem LUT e o processado pela LUT."),
      P("SkyTurbidity", "number", "IL-F14: turbidez do céu físico (1.7–10, default 3) — só com RenderStyle 'Realistic'. 2 = céu limpo profundo; 10 = bruma pesada lavando o azul."),
      P("SkyGroundAlbedo", "number", "IL-F14: albedo do chão do céu físico (0–1, default 0.25) — cor do hemisfério abaixo do horizonte no modo 'Realistic'."),

      P("GlobalIllumination", "boolean",
        "GI dinâmica \"Lumen-lite\" (IL-F39): multi-bounce fatiado no ócio + emissivos Neon em nits + especular para roughness alta. " +
        "null/AUTO ativa no RenderStyle 'Realistic' + Technology 'Future' + GPU forte; " +
        "true força (G210 fraca entra em modo lite); false desliga."),
      P("ReflectionProbes", "boolean", "Reflection probes locais (IL-F22 do plano de iluminação): volumes de captura com blend por distância/prioridade, rodízio de 1 face por frame e parallax box projection; orçamento por tier (0/2/4; perfil fraco só forçado = 1). Tri-state — nil/ausente = AUTO (liga com RenderStyle 'Realistic' na GPU forte); true força onde há orçamento; false desliga."),
      P("PlanarReflections", "boolean", "Reflexo planar real da água do terreno + Parts espelho (IL-F23 do plano de iluminação): câmera virtual espelhada no plano ativo (½ res, teto 1280, near plane oblíquo para oclusão correta), 1 plano ativo por frame (o de maior peso na tela), Fresnel da água + ganho de espelho de Part. Tri-state — nil/ausente = auto (liga só com RenderStyle 'Realistic' na GPU forte; OFF no perfil fraco é aceite — SSR/céu assumem); true força na GPU forte; false desliga."),
      P("TemporalAA", "boolean", "Anti-aliasing temporal TAA-lite (IL-F32 do plano de iluminação): jitter sub-pixel + acumulação com reprojeção e clamp de vizinhança 3×3 anti-ghosting (2 alvos FP16 full-res). Tri-state — nil/ausente = AUTO (hoje OFF, opt-in até calibrar; precedente IL-F5); true liga na GPU forte (perfil fraco VETA SEMPRE); false desliga."),
      P("MotionBlur", "boolean", "Motion blur de CÂMERA (IL-F32 do plano de iluminação): reprojeção por depth, 8 taps, shutter 180°. Tri-state — nil/ausente = AUTO (hoje OFF fora do modo photo/play); true liga na GPU forte (perfil fraco veta); false desliga."),
      P("ObjectMotionVectors", "boolean", "Motion vectors de objetos rígidos (IL-F40 do plano de iluminação): pass de velocidade em ½-res RGBA8 por mesh que move, alimenta MB de objeto e reprojeção do TAA. Tri-state: nil/ausente = AUTO (liga quando MB ou TAA ativos na GPU forte); true força (perfil fraco VETA sempre; custo 1 pass geom ½-res); false desativa. Skinned/física = pendente fatia B."),
      P("TemporalUpscale", "boolean", "Upscale temporal (IL-F40 do plano de iluminação): renderiza em escala < 1 e reconstrói via acumulação temporal. Tri-state: nil/ausente = AUTO OFF (opt-in futuro, ADAPTIVE_RES_OFF=true no projeto); true = liga SÓ se TAA on && GPU forte; false veta."),
      P("ChromaticAberration", "number", "Aberração cromática de lente (IL-F32 do plano de iluminação): offset RGB radial que cresce nas bordas da tela. 0–1; 0 (default) = OFF byte a byte; doses baixas (0.1–0.3) dão look de lente real."),
      P("FilmGrain", "number", "Film grain HDR-aware (IL-F32 do plano de iluminação): aplicado DEPOIS do tonemap e ANTES da OETF sRGB, com amplitude por luminância (sombras granulam como filme, highlights limpos). 0–1; 0 (default) = OFF byte a byte."),
    ],
    m: [
      M("GetMinutesAfterMidnight", [], "number", "Minutos passados desde a meia-noite (ClockTime * 60)."),
      M("SetMinutesAfterMidnight", [par("minutes", "number")], "void", "Define a hora do dia em minutos desde a meia-noite (wrap de 24h; TimeOfDay/ClockTime sincronizam)."),
    ],
  }),
  Clouds: C("Instance", "Nuvens dinâmicas 2.5D no céu (IL-F19 do plano de iluminação). Paridade Roblox: filha do Terrain (o render também aceita Workspace/Lighting). Iluminadas pelo sol (golden hour tinge as bordas, silver lining), derivam com o vento, ocluem sol/lua/estrelas e desligam sozinhas no tier micro do perfil de GPU fraca.", {
    p: [
      P("Enabled", "boolean", "Liga/desliga a camada de nuvens."),
      P("Cover", "number", "Cobertura do céu (0 a 1): 0 = céu limpo, 1 = encoberto."),
      P("Density", "number", "Densidade/opacidade das nuvens (0 a 1)."),
      P("Color", "Color3", "Tinte do material das nuvens."),
    ],
  }),

  ReflectionProbe: C("Instance", "Probe de reflexo local parallax-corrected (IL-F22). Filho de Lighting; herda IBL global + corrige vetores especulares pelo volume Box/Sphere.", {
    p: [
      P("Enabled", "boolean", "Ativa/desativa o probe (false restaura o IBL global)."),
      P("Shape", "string", "Box ou Sphere — forma do volume de influência."),
      P("Position", "Vector3", "Centro do volume no espaço de mundo."),
      P("Size", "Vector3", "Dimensões do volume (Box) ou diâmetro em X (Sphere)."),
      P("Priority", "number", "Prioridade de sobreposição (maior = vence)."),
      P("Resolution", "number", "Resolução do cubemap: 64 ou 128 px por face."),
      P("BlendDistance", "number", "Margem de blend na borda do volume (studs)."),
    ],
  }),




  SurfaceAppearance: C("Instance", "Mapas PBR de um MeshPart (filho do MeshPart). ORM packing implícito (MetalnessMap == RoughnessMap ⇒ R=AO/G=Rough/B=Metal), AlphaMode completo, detail maps e POM opcional (IL-F10).", {
    p: [
      P("SubstrateMaterial", "string", SUBSTRATE_PUBLIC_API.SubstrateMaterial.description, { category: "Appearance" }),
      P("ColorMap", "string", "Asset ID do albedo (sRGB). O alfa participa do AlphaMode."),
      P("NormalMap", "string", "Asset ID do normal map tangente (linear)."),
      P("MetalnessMap", "string", "Asset ID do metalness (canal B). Igual ao RoughnessMap ⇒ ORM packed (R=AO liga de graça)."),
      P("RoughnessMap", "string", "Asset ID do roughness (canal G)."),
      P("AlphaMode", "string", "Overlay (alfa mistura a textura sobre a Color), Transparency (blend legado) ou TintMask (alfa mascara onde a Color tinge)."),
      P("Color", "Color3", "Tinte do material (o uso depende do AlphaMode)."),
      P("NormalMapConvention", "string", "Auto, OpenGL ou DirectX (DirectX inverte o canal Y/verde do normal)."),
      P("HeightMap", "string", "Asset ID da altura (canal R; 1 = topo da superfície). Liga POM em GPU forte."),
      P("HeightScale", "number", "Profundidade do POM em UV (0 a 0.2; 0 desliga)."),
      P("DetailColorMap", "string", "Albedo de detalhe em tile (neutro 0.5, aplicado ×2). Requer ColorMap."),
      P("DetailNormalMap", "string", "Normal de detalhe em tile (blend UDN). Requer NormalMap."),
      P("DetailTiling", "number", "Repetições do detalhe sobre o UV base (0.05 a 256)."),
    ],
  }),
  Atmosphere: C("Instance", "Efeito atmosférico (filho de Lighting).", {
    p: [
      P("Density", "number", "Densidade do ar (0 a 1)."),
      P("Offset", "number", "Deslocamento da curvatura no horizonte."),
      P("Color", "Color3", "Tom da atmosfera."),
      P("Decay", "Color3", "Cor de decaimento ao longe."),
      P("Glare", "number", "Brilho ao redor do sol."),
      P("Haze", "number", "Neblina visível."),
    ],
  }),
  Sky: C("Instance", "Skybox de seis faces (filho de Lighting).", {
    p: [
      P("SkyboxBk", "string", "Textura de trás do skybox."),
      P("SkyboxDn", "string", "Textura de baixo do skybox."),
      P("SkyboxFt", "string", "Textura da frente do skybox."),
      P("SkyboxLf", "string", "Textura da esquerda do skybox."),
      P("SkyboxRt", "string", "Textura da direita do skybox."),
      P("SkyboxUp", "string", "Textura de cima do skybox."),
      P("SkyboxHdri", "string", "Asset ID local de um .hdr/.exr usado como céu equiretangular e luz IBL (IL-F16; vazio = céu clássico)."),
      P("HdriIntensity", "number", "Multiplicador de intensidade do HDRI (0–8; padrão 1)."),
      P("SunAngularSize", "number", "Tamanho aparente do sol (graus)."),
      P("SunTextureId", "string", "Textura do disco do sol (Asset ID de imagem importada; vazio usa o disco padrão)."),
      P("MoonAngularSize", "number", "Tamanho aparente da lua (graus)."),
      P("MoonPhase", "number", "Fase da lua (IL-F19): 0 = nova, 0.5 = cheia (padrão), 1 = nova. Com Lighting.RenderStyle 'Realistic' desenha terminador esférico + earthshine + halo; no 'Classic' o disco segue cheio (byte a byte)."),
      P("MoonTextureId", "string", "Textura do disco da lua (Asset ID de imagem importada; vazio usa o disco padrão)."),
      P("StarCount", "number", "Quantidade de estrelas."),
      P("CelestialBodiesShown", "boolean", "Se sol/lua/estrelas aparecem."),
    ],
  }),


  ParticleEmitter: C("Instance", "Emissor de partículas 2D no mundo 3D.", {
    p: [
      P("Enabled", "boolean", "Se emite partículas continuamente."),
      P("Rate", "number", "Partículas emitidas por segundo."),
      P("Lifetime", "NumberRange", "Tempo de vida de cada partícula (s)."),
      P("Speed", "NumberRange", "Velocidade inicial das partículas."),
      P("Size", "NumberSequence", "Tamanho ao longo da vida."),
      P("Transparency", "NumberSequence", "Transparência ao longo da vida."),
      P("Color", "ColorSequence", "Cor ao longo da vida."),
      P("Texture", "string", "Textura da partícula."),
      P("EmissionDirection", "Enum.NormalId", "Face de emissão."),
      P("Rotation", "NumberRange", "Rotação inicial (graus)."),
      P("RotSpeed", "NumberRange", "Velocidade de rotação (graus/s)."),
      P("SpreadAngle", "Vector2", "Ângulo de espalhamento (X, Y)."),
      P("Acceleration", "Vector3", "Aceleração aplicada às partículas."),
      P("Drag", "number", "Arrasto aplicado às partículas."),
      P("LightEmission", "number", "Mistura aditiva (0 a 1)."),
      P("LightInfluence", "number", "Quanto a iluminação afeta as partículas."),
      P("ZOffset", "number", "Deslocamento em direção à câmera."),
    ],
    m: [
      M("Emit", [par("particleCount", "number", true, "16")], "void", "Emite um burst de partículas imediatamente."),
      M("Clear", [], "void", "Remove todas as partículas vivas."),
    ],
  }),
  Beam: C("Instance", "Feixe texturizado entre dois Attachments.", {
    p: [
      P("Attachment0", "Attachment", "Attachment inicial do feixe."),
      P("Attachment1", "Attachment", "Attachment final do feixe."),
      P("Color", "ColorSequence", "Cor ao longo do feixe."),
      P("Transparency", "NumberSequence", "Transparência ao longo do feixe."),
      P("Width0", "number", "Largura no início."),
      P("Width1", "number", "Largura no fim."),
      P("CurveSize0", "number", "Curvatura no início (Bezier)."),
      P("CurveSize1", "number", "Curvatura no fim (Bezier)."),
      P("Segments", "number", "Número de segmentos do feixe."),
      P("Texture", "string", "Textura do feixe."),
      P("TextureSpeed", "number", "Velocidade de rolagem da textura."),
      P("FaceCamera", "boolean", "Se o feixe sempre encara a câmera."),
      P("Enabled", "boolean", "Se o feixe é renderizado."),
    ],
    m: [M("SetTextureOffset", [par("offset", "number", true, "0")], "void", "Define o deslocamento atual da textura do feixe (cíclico: 0 a 1; funciona mesmo com TextureSpeed = 0).")],
  }),
  Trail: C("Instance", "Rastro deixado entre dois Attachments em movimento.", {
    p: [
      P("Attachment0", "Attachment", "Primeiro attachment do rastro."),
      P("Attachment1", "Attachment", "Segundo attachment do rastro."),
      P("Color", "ColorSequence", "Cor ao longo do rastro."),
      P("Transparency", "NumberSequence", "Transparência ao longo do rastro."),
      P("Lifetime", "number", "Quanto tempo o rastro permanece (s)."),
      P("WidthScale", "NumberSequence", "Escala de largura ao longo da vida."),
      P("Texture", "string", "Textura do rastro."),
      P("Enabled", "boolean", "Se o rastro é gerado."),
    ],
    m: [M("Clear", [], "void", "Limpa o rastro atual.")],
  }),
  Fire: C("Instance", "Efeito clássico de fogo.", {
    p: [
      P("Heat", "number", "Velocidade vertical das chamas (-25 a 25)."),
      P("Size", "number", "Tamanho das chamas (2 a 30)."),
      P("Color", "Color3", "Cor principal do fogo."),
      P("SecondaryColor", "Color3", "Cor secundária do fogo."),
      P("Enabled", "boolean", "Se o fogo é renderizado."),
    ],
  }),
  Smoke: C("Instance", "Efeito clássico de fumaça.", {
    p: [
      P("Color", "Color3", "Cor da fumaça."),
      P("Opacity", "number", "Opacidade da fumaça (0 a 1)."),
      P("RiseVelocity", "number", "Velocidade de subida (-25 a 25)."),
      P("Size", "number", "Tamanho da fumaça (0.1 a 100)."),
      P("Enabled", "boolean", "Se a fumaça é renderizada."),
    ],
  }),
  Sparkles: C("Instance", "Efeito clássico de faíscas.", {
    p: [
      P("SparkleColor", "Color3", "Cor das faíscas."),
      P("Enabled", "boolean", "Se as faíscas são renderizadas."),
    ],
  }),
  Explosion: C("Instance", "Explosão com força física e dano.", {
    p: [
      P("BlastPressure", "number", "Força aplicada às partes próximas."),
      P("BlastRadius", "number", "Raio da explosão em studs."),
      P("Position", "Vector3", "Centro da explosão no mundo."),
      P("DestroyJointRadiusPercent", "number", "Fração do raio que quebra juntas (0 a 1)."),
      P("ExplosionType", "Enum.ExplosionType", "Se a explosão cria crateras no terreno."),
      P("Visible", "boolean", "Se o efeito visual aparece."),
    ],
    e: [E("Hit", [par("part", "BasePart"), par("distance", "number")], "Disparado para cada parte atingida.")],
  }),


  ScreenGui: C("Instance", "Contêiner 2D renderizado na tela do jogador.", {
    p: [
      P("Enabled", "boolean", "Se a GUI é renderizada."),
      P("DisplayOrder", "number", "Ordem de renderização entre ScreenGuis."),
      P("IgnoreGuiInset", "boolean", "Ignora o inset da topbar do Roblox."),
      P("ResetOnSpawn", "boolean", "Se a GUI é recriada quando o personagem nasce."),
    ],
  }),
  GuiObject: C("Instance", "Base de todos os elementos 2D visíveis.", {
    p: [
      P("Position", "UDim2", "Posição relativa ao pai (Scale + Offset).", { category: "Transform" }),
      P("Size", "UDim2", "Tamanho relativo ao pai (Scale + Offset).", { category: "Transform" }),
      P("AnchorPoint", "Vector2", "Ponto de ancoragem (0,0 a 1,1).", { category: "Transform" }),
      P("Rotation", "number", "Rotação em graus.", { category: "Transform" }),
      P("BackgroundColor3", "Color3", "Cor de fundo.", { category: "Appearance" }),
      P("BackgroundTransparency", "number", "Transparência do fundo (0 a 1).", { category: "Appearance" }),
      P("BorderColor3", "Color3", "Cor da borda.", { category: "Appearance" }),
      P("BorderSizePixel", "number", "Espessura da borda em pixels.", { category: "Appearance" }),
      P("Visible", "boolean", "Se o elemento é renderizado."),
      P("ZIndex", "number", "Ordem de empilhamento entre irmãos."),
      P("LayoutOrder", "number", "Ordem usada por UIListLayout/UIGridLayout."),
      P("ClipsDescendants", "boolean", "Recorta filhos que saem dos limites."),
      P("Active", "boolean", "Se captura eventos de input."),
      P("AbsolutePosition", "Vector2", "Posição absoluta em pixels.", { readOnly: true }),
      P("AbsoluteSize", "Vector2", "Tamanho absoluto em pixels.", { readOnly: true }),
    ],
    m: [
      M("TweenPosition", [par("endPosition", "UDim2"), par("easingDirection", "Enum.EasingDirection", true), par("easingStyle", "Enum.EasingStyle", true), par("time", "number", true, "1"), par("override", "boolean", true, "false"), par("callback", "function", true)], "boolean", "Anima a posição do elemento."),
      M("TweenSize", [par("endSize", "UDim2"), par("easingDirection", "Enum.EasingDirection", true), par("easingStyle", "Enum.EasingStyle", true), par("time", "number", true, "1"), par("override", "boolean", true, "false"), par("callback", "function", true)], "boolean", "Anima o tamanho do elemento."),
      M("TweenSizeAndPosition", [par("endSize", "UDim2"), par("endPosition", "UDim2"), par("easingDirection", "Enum.EasingDirection", true), par("easingStyle", "Enum.EasingStyle", true), par("time", "number", true, "1"), par("override", "boolean", true, "false"), par("callback", "function", true)], "boolean", "Anima tamanho e posição juntos."),
    ],
    e: [
      E("MouseEnter", [par("x", "number"), par("y", "number")], "Disparado quando o mouse entra no elemento."),
      E("MouseLeave", [par("x", "number"), par("y", "number")], "Disparado quando o mouse sai do elemento."),
      E("InputBegan", [par("input", "InputObject")], "Disparado quando um input começa sobre o elemento."),
      E("InputEnded", [par("input", "InputObject")], "Disparado quando um input termina sobre o elemento."),
    ],
  }),
  Frame: C("GuiObject", "Retângulo simples usado como contêiner de GUI.", {}),
  GuiButton: C("GuiObject", "Base dos botões clicáveis.", {
    p: [P("AutoButtonColor", "boolean", "Escurece o botão automaticamente ao interagir.")],
    e: [
      E("Activated", [par("inputObject", "InputObject"), par("clickCount", "number")], "Disparado em clique/toque completo (recomendado)."),
      E("MouseButton1Click", [], "Disparado em clique completo com o botão esquerdo."),
      E("MouseButton1Down", [par("x", "number"), par("y", "number")], "Botão esquerdo pressionado."),
      E("MouseButton1Up", [par("x", "number"), par("y", "number")], "Botão esquerdo solto."),
      E("MouseButton2Click", [], "Disparado em clique completo com o botão direito."),
    ],
  }),
  TextLabel: C("GuiObject", "Exibe texto não interativo.", {
    p: [
      P("Text", "string", "Texto exibido.", { category: "Text" }),
      P("TextColor3", "Color3", "Cor do texto.", { category: "Text" }),
      P("TextSize", "number", "Tamanho da fonte em pixels.", { category: "Text" }),
      P("Font", "Enum.Font", "Fonte do texto.", { category: "Text" }),
      P("TextWrapped", "boolean", "Quebra o texto em múltiplas linhas.", { category: "Text" }),
      P("TextXAlignment", "Enum.TextXAlignment", "Alinhamento horizontal.", { category: "Text" }),
      P("TextYAlignment", "Enum.TextYAlignment", "Alinhamento vertical.", { category: "Text" }),
      P("RichText", "boolean", "Habilita marcação rich text no Text.", { category: "Text" }),
    ],
  }),
  TextButton: C("GuiButton", "Botão com texto.", {
    p: [
      P("Text", "string", "Texto exibido no botão.", { category: "Text" }),
      P("TextColor3", "Color3", "Cor do texto.", { category: "Text" }),
      P("TextSize", "number", "Tamanho da fonte em pixels.", { category: "Text" }),
      P("Font", "Enum.Font", "Fonte do texto.", { category: "Text" }),
      P("TextWrapped", "boolean", "Quebra o texto em múltiplas linhas.", { category: "Text" }),
    ],
  }),
  TextBox: C("GuiObject", "Campo de entrada de texto editável pelo jogador.", {
    p: [
      P("Text", "string", "Texto atual do campo.", { category: "Text" }),
      P("PlaceholderText", "string", "Texto exibido quando o campo está vazio.", { category: "Text" }),
      P("PlaceholderColor3", "Color3", "Cor do placeholder.", { category: "Text" }),
      P("ClearTextOnFocus", "boolean", "Limpa o texto ao focar."),
      P("MultiLine", "boolean", "Permite múltiplas linhas (Enter insere quebra)."),
      P("TextColor3", "Color3", "Cor do texto.", { category: "Text" }),
      P("TextSize", "number", "Tamanho da fonte.", { category: "Text" }),
      P("Font", "Enum.Font", "Fonte do texto.", { category: "Text" }),
    ],
    m: [
      M("CaptureFocus", [], "void", "Foca o campo de texto."),
      M("ReleaseFocus", [par("submitted", "boolean", true, "false")], "void", "Remove o foco do campo."),
      M("IsFocused", [], "boolean", "True se o campo está focado."),
    ],
  }),
  ImageLabel: C("GuiObject", "Exibe uma imagem não interativa.", {
    p: [
      P("Image", "string", "ID do asset da imagem.", { category: "Image" }),
      P("ImageColor3", "Color3", "Tonalização da imagem.", { category: "Image" }),
      P("ImageTransparency", "number", "Transparência da imagem.", { category: "Image" }),
      P("ScaleType", "Enum.ScaleType", "Modo de escala (Stretch, Slice, Tile...).", { category: "Image" }),
      P("SliceCenter", "Rect", "Centro do 9-slice (quando ScaleType = Slice).", { category: "Image" }),
      P("TileSize", "UDim2", "Tamanho do tile (quando ScaleType = Tile).", { category: "Image" }),
    ],
  }),
  ImageButton: C("GuiButton", "Botão com imagem.", {
    p: [
      P("Image", "string", "ID do asset da imagem normal.", { category: "Image" }),
      P("ImageColor3", "Color3", "Tonalização da imagem.", { category: "Image" }),
      P("ImageTransparency", "number", "Transparência da imagem.", { category: "Image" }),
      P("ScaleType", "Enum.ScaleType", "Modo de escala da imagem.", { category: "Image" }),
    ],
  }),
  ScrollingFrame: C("GuiObject", "Contêiner com barra de rolagem.", {
    p: [
      P("CanvasSize", "UDim2", "Tamanho total da área rolável."),
      P("ScrollBarThickness", "number", "Espessura da barra de rolagem em pixels."),
      P("ScrollBarImageColor3", "Color3", "Cor da barra de rolagem."),
      P("ScrollingEnabled", "boolean", "Se a rolagem está habilitada."),
    ],
  }),
  UIListLayout: C("Instance", "Organiza irmãos em lista vertical/horizontal.", {
    p: [
      P("FillDirection", "Enum.FillDirection", "Direção da lista (Horizontal/Vertical)."),
      P("HorizontalAlignment", "Enum.HorizontalAlignment", "Alinhamento horizontal dos itens."),
      P("VerticalAlignment", "Enum.VerticalAlignment", "Alinhamento vertical dos itens."),
      P("Padding", "UDim", "Espaçamento entre itens."),
      P("SortOrder", "Enum.SortOrder", "Ordenação (LayoutOrder ou Name)."),
    ],
  }),
  UIGridLayout: C("Instance", "Organiza irmãos em grade de células uniformes.", {
    p: [
      P("CellSize", "UDim2", "Tamanho de cada célula."),
      P("CellPadding", "UDim2", "Espaçamento entre células."),
      P("FillDirection", "Enum.FillDirection", "Direção de preenchimento da grade."),
      P("SortOrder", "Enum.SortOrder", "Ordenação (LayoutOrder ou Name)."),
    ],
  }),
  UICorner: C("Instance", "Arredonda os cantos do GuiObject pai.", {
    p: [P("CornerRadius", "UDim", "Raio do arredondamento (Scale + Offset).")],
  }),
  UIStroke: C("Instance", "Contorno aplicado ao GuiObject ou texto pai.", {
    p: [
      P("Color", "Color3", "Cor do contorno."),
      P("Thickness", "number", "Espessura do contorno em pixels."),
      P("Transparency", "number", "Transparência do contorno."),
      P("ApplyStrokeMode", "Enum.ApplyStrokeMode", "Se aplica ao contorno do elemento ou do texto."),
      P("Enabled", "boolean", "Se o contorno é renderizado."),
    ],
  }),
  UIGradient: C("Instance", "Gradiente de cor/transparência no GuiObject pai.", {
    p: [
      P("Color", "ColorSequence", "Sequência de cores do gradiente."),
      P("Transparency", "NumberSequence", "Sequência de transparência."),
      P("Rotation", "number", "Rotação do gradiente em graus."),
      P("Offset", "Vector2", "Deslocamento do gradiente."),
      P("Enabled", "boolean", "Se o gradiente é aplicado."),
    ],
  }),
  UIPadding: C("Instance", "Margens internas no GuiObject pai.", {
    p: [
      P("PaddingTop", "UDim", "Margem superior."),
      P("PaddingBottom", "UDim", "Margem inferior."),
      P("PaddingLeft", "UDim", "Margem esquerda."),
      P("PaddingRight", "UDim", "Margem direita."),
    ],
  }),
  BillboardGui: C("Instance", "GUI 2D ancorada a um objeto 3D, sempre de frente para a câmera.", {
    p: [
      P("Adornee", "Instance", "Objeto 3D ao qual a GUI é ancorada."),
      P("Size", "UDim2", "Tamanho (Scale = studs, Offset = pixels)."),
      P("FixedWorldSize", "boolean", "true = tamanho fixo no mundo (Offset vira studs a 50 px/stud; nao reescala com a distancia da camera)."),
      P("StudsOffset", "Vector3", "Deslocamento em studs no espaço da câmera."),
      P("AlwaysOnTop", "boolean", "Renderiza sobre a geometria 3D."),
      P("MaxDistance", "number", "Distância máxima de visibilidade."),
      P("LightInfluence", "number", "Quanto a iluminação afeta a GUI."),
      P("Enabled", "boolean", "Se a GUI é renderizada."),
    ],
  }),
  SurfaceGui: C("Instance", "GUI 2D renderizada na face de uma parte.", {
    p: [
      P("Adornee", "Instance", "Parte onde a GUI é renderizada (ou o Parent)."),
      P("Face", "Enum.NormalId", "Face da parte usada."),
      P("CanvasSize", "Vector2", "Resolução do canvas em pixels."),
      P("AlwaysOnTop", "boolean", "Renderiza sobre a geometria 3D."),
      P("LightInfluence", "number", "Quanto a iluminação afeta a GUI."),
      P("PixelsPerStud", "number", "Densidade de pixels por stud."),
      P("Enabled", "boolean", "Se a GUI é renderizada."),
    ],
  }),
  SelectionBox: C("Instance", "Contorno de seleção em caixa ao redor do Adornee.", {
    p: [
      P("Adornee", "PVInstance", "Objeto contornado."),
      P("Color3", "Color3", "Cor das linhas do contorno."),
      P("LineThickness", "number", "Espessura relativa das linhas."),
      P("SurfaceColor3", "Color3", "Cor das superfícies preenchidas."),
      P("SurfaceTransparency", "number", "Transparência das superfícies (1 = só linhas)."),
    ],
  }),
  SelectionSphere: C("Instance", "Esfera de seleção ao redor do Adornee.", {
    p: [
      P("Adornee", "PVInstance", "Objeto envolvido pela esfera."),
      P("Color3", "Color3", "Cor da esfera."),
      P("SurfaceColor3", "Color3", "Cor da superfície da esfera."),
      P("SurfaceTransparency", "number", "Transparência da superfície."),
    ],
  }),


  PackageLink: C("Instance", "Marca o pai como inst\u00e2ncia de um Package versionado (somente editor).", {
    p: [
      P("PackageId", "string", "Identificador \u00fanico do package no armazenamento local."),
      P("VersionNumber", "number", "Vers\u00e3o atual da c\u00f3pia.", { readOnly: true }),
      P("AutoUpdate", "boolean", "Atualiza automaticamente quando uma nova vers\u00e3o \u00e9 publicada."),
      P("Status", "Enum.PackagePermission", "UpToDate, Modified ou OutOfDate.", { readOnly: true }),
    ],
  }),
  Highlight: C("Instance", "Destaque visual permanente (preenchimento + contorno de silhueta).", {
    p: [
      P("Adornee", "PVInstance", "Objeto destacado (padr\u00e3o: Parent)."),
      P("FillColor", "Color3", "Cor do preenchimento."),
      P("FillTransparency", "number", "Transpar\u00eancia do preenchimento (0 a 1)."),
      P("OutlineColor", "Color3", "Cor do contorno."),
      P("OutlineTransparency", "number", "Transpar\u00eancia do contorno (0 a 1)."),
      P("DepthMode", "Enum.HighlightDepthMode", "AlwaysOnTop ou Occluded."),
      P("Enabled", "boolean", "Liga/desliga o destaque."),
    ],
  }),
  DragDetector: C("Instance", "Permite arrastar a BasePart pai durante o Playtest.", {
    p: [
      P("DragStyle", "Enum.DragDetectorDragStyle", "TranslateLine/Plane/PlaneOrLine/ViewPlane, RotateAxis/Trackball, Scriptable, BestForDevice."),
      P("ResponseStyle", "Enum.DragDetectorResponseStyle", "Physical (for\u00e7as), Geometric (direto) ou Custom."),
      P("Enabled", "boolean", "Liga/desliga o detector."),
      P("MaxDragAngle", "number", "Limite de rota\u00e7\u00e3o."),
      P("MaxDragTranslation", "number", "Limite de dist\u00e2ncia."),
      P("MaxForce", "number", "For\u00e7a m\u00e1xima (Physical)."),
      P("MaxTorque", "number", "Torque m\u00e1ximo (Physical)."),
      P("ReferenceInstance", "Instance", "Refer\u00eancia para o eixo de drag."),
      P("Axis", "Vector3", "Eixo para TranslateLine e RotateAxis."),
      P("PermissionPolicy", "Enum.DragDetectorPermissionPolicy", "All, Nobody ou Scriptable."),
      P("RunLocally", "boolean", "Drag processado no Client."),
      P("ApplyAtCenterOfMass", "boolean", "Aplica for\u00e7a no centro de massa."),
      P("CursorIcon", "string", "Cursor durante hover."),
      P("ActivatedCursorIcon", "string", "Cursor durante o arraste."),
    ],
    e: [
      E("DragStart", [par("player", "Player"), par("cursorRay", "Ray")], "In\u00edcio do arraste."),
      E("DragContinue", [par("player", "Player"), par("cursorRay", "Ray")], "Durante o arraste."),
      E("DragEnd", [par("player", "Player")], "Fim do arraste."),
      E("MouseHoverEnter", [par("player", "Player")], "Cursor entrou sobre a Part."),
      E("MouseHoverLeave", [par("player", "Player")], "Cursor saiu da Part."),
    ],
  }),
  UIDragDetector: C("Instance", "Permite arrastar o GuiObject pai durante o Playtest.", {
    p: [
      P("DragStyle", "Enum.UIDragDetectorDragStyle", "TranslateLine, TranslatePlane, Rotate ou Scriptable."),
      P("ResponseStyle", "Enum.UIDragDetectorResponseStyle", "Offset (Position), Scale (Size) ou Custom."),
      P("Enabled", "boolean", "Liga/desliga o detector."),
      P("BoundaryMin", "UDim2", "Limite m\u00ednimo do arraste."),
      P("BoundaryMax", "UDim2", "Limite m\u00e1ximo do arraste."),
      P("DragRelativity", "Enum.UIDragDetectorDragRelativity", "Relative ou Absolute."),
      P("MaxDragAngle", "number", "\u00c2ngulo m\u00e1ximo (Rotate)."),
      P("MinDragAngle", "number", "\u00c2ngulo m\u00ednimo (Rotate)."),
      P("ReferenceUIInstance", "Instance", "Refer\u00eancia para c\u00e1lculos relativos."),
      P("CursorIcon", "string", "Cursor durante hover."),
    ],
    e: [
      E("DragStart", [par("inputPosition", "Vector2")], "In\u00edcio do arraste."),
      E("DragContinue", [par("inputPosition", "Vector2"), par("delta", "Vector2")], "Durante o arraste."),
      E("DragEnd", [par("inputPosition", "Vector2")], "Fim do arraste."),
    ],
  }),
  Handles: C("Instance", "Al\u00e7as de manipula\u00e7\u00e3o nas faces de uma Part (ferramentas de plugin).", {
    p: [
      P("Adornee", "BasePart", "Part manipulada."),
      P("Color3", "Color3", "Cor das al\u00e7as."),
      P("Style", "Enum.HandlesStyle", "Resize ou Move."),
      P("Faces", "Faces", "Quais faces mostram al\u00e7as."),
      P("Visible", "boolean", "Se as al\u00e7as s\u00e3o renderizadas."),
    ],
    e: [
      E("MouseButton1Down", [par("face", "Enum.NormalId")], "Bot\u00e3o esquerdo pressionado em uma al\u00e7a; recebe a face."),
      E("MouseButton1Up", [par("face", "Enum.NormalId")], "Bot\u00e3o esquerdo solto ap\u00f3s pressionar uma al\u00e7a; recebe a face."),
      E("MouseDrag", [par("face", "Enum.NormalId"), par("distance", "number")], "Arraste com o bot\u00e3o pressionado; distance \u00e9 o deslocamento em studs ao longo da normal da face."),
    ],
  }),
  ArcHandles: C("Instance", "An\u00e9is de rota\u00e7\u00e3o ao redor de uma Part (ferramentas de plugin).", {
    p: [
      P("Adornee", "BasePart", "Part manipulada."),
      P("Color3", "Color3", "Cor dos an\u00e9is."),
      P("Axes", "Axes", "Quais eixos mostram an\u00e9is."),
      P("Visible", "boolean", "Se os an\u00e9is s\u00e3o renderizados."),
    ],
    e: [
      E("MouseButton1Down", [par("axis", "Enum.Axis")], "Bot\u00e3o esquerdo pressionado em um anel; recebe o eixo."),
      E("MouseButton1Up", [par("axis", "Enum.Axis")], "Bot\u00e3o esquerdo solto ap\u00f3s pressionar um anel; recebe o eixo."),
      E("MouseDrag", [par("axis", "Enum.Axis"), par("relativeAngle", "number"), par("deltaAngle", "number")], "Arraste rotacional; \u00e2ngulos em radianos (relativo ao in\u00edcio e delta desde o \u00faltimo evento)."),
    ],
  }),


  Attachment: C("Instance", "Ponto de referência em uma BasePart usado por constraints/efeitos.", {
    p: [
      P("CFrame", "CFrame", "CFrame relativo à parte pai.", { category: "Transform" }),
      P("Position", "Vector3", "Posição relativa à parte pai.", { category: "Transform" }),
      P("WorldPosition", "Vector3", "Posição no espaço do mundo.", { readOnly: true, category: "Transform" }),
      P("WorldCFrame", "CFrame", "CFrame no espaço do mundo.", { readOnly: true, category: "Transform" }),
      P("Axis", "Vector3", "Eixo primário do attachment."),
      P("SecondaryAxis", "Vector3", "Eixo secundário (Y local); atribuir reorienta o attachment preservando o Axis (Parte 156)."),
      P("Visible", "boolean", "Se o attachment é visualizado no editor."),
    ],
  }),




  Bone: C("Attachment", "Osso de esqueleto para skinned meshes. A pose carrega rotação real: Transform e WorldCFrame são CFrames completos (posição + rotação, ordem YXZ).", {
    p: [
      P("Transform", "CFrame", "Offset animável aplicado sobre a pose de repouso. CFrame COMPLETO: além da posição, carrega a rotação real do osso (Parte 139). A rotação é persistida em TransformRotation (graus, ordem YXZ); atribuir rotação identidade zera TransformRotation.", { category: "Transform" }),
      P("TransformRotation", "Vector3", "Rotação do Transform em graus (ordem YXZ), nos eixos do pai do osso. É a componente de rotação real do CFrame devolvido por Transform/WorldCFrame (Parte 139).", { category: "Transform" }),
      P("WorldCFrame", "CFrame", "CFrame do osso no espaço do mundo com rotação real: COMPOSIÇÃO da hierarquia de Bones (posição E rotação), não apenas soma de posições (Parte 139).", { readOnly: true, category: "Transform" }),
      P("WorldPosition", "Vector3", "Posição no mundo derivada da mesma composição do WorldCFrame — rotação de ossos ancestrais muda este valor (Parte 139).", { readOnly: true, category: "Transform" }),
    ],
    m: [
      M("GetRelativeTransform", [], "CFrame", "Transform relativo do osso como CFrame completo: posição + rotação real (Parte 139)."),
      M("GetRelativeTransformAll", [], "CFrame", "Composição dos Transforms da cadeia de Bones até a raiz, como CFrame completo com rotação real (Parte 139)."),
    ],
  }),
  Constraint: C("Instance", "Base das restrições físicas entre dois Attachments.", {
    p: [
      P("Attachment0", "Attachment", "Primeiro attachment."),
      P("Attachment1", "Attachment", "Segundo attachment."),
      P("Enabled", "boolean", "Se a constraint está ativa."),
      P("Visible", "boolean", "Se a constraint é visualizada no editor."),
    ],
  }),
  WeldConstraint: C("Instance", "Solda rígida entre duas partes (sem attachments).", {
    p: [
      P("Part0", "BasePart", "Primeira parte soldada."),
      P("Part1", "BasePart", "Segunda parte soldada."),
      P("Enabled", "boolean", "Se a solda está ativa."),
    ],
  }),
  HingeConstraint: C("Constraint", "Dobradiça: rotação em um eixo, opcionalmente motorizada.", {
    p: [
      P("ActuatorType", "Enum.ActuatorType", "None, Motor ou Servo."),
      P("AngularVelocity", "number", "Velocidade alvo do motor (rad/s)."),
      P("MotorMaxTorque", "number", "Torque máximo do motor."),
      P("ServoMaxTorque", "number", "Torque máximo do servo."),
      P("TargetAngle", "number", "Ângulo alvo do servo (graus)."),
      P("LimitsEnabled", "boolean", "Habilita limites de ângulo."),
      P("LowerAngle", "number", "Limite inferior (graus)."),
      P("UpperAngle", "number", "Limite superior (graus)."),
      P("CurrentAngle", "number", "Ângulo atual da dobradiça em graus (telemetria de Play/Run; 0 no modo edição).", { readOnly: true }),
      P("AngularSpeed", "number", "Velocidade angular atual no eixo, em rad/s (telemetria de Play/Run; 0 no modo edição).", { readOnly: true }),
    ],
  }),
  RopeConstraint: C("Constraint", "Corda de comprimento máximo fixo entre dois attachments.", {
    p: [
      P("Length", "number", "Comprimento máximo da corda."),
      P("Thickness", "number", "Espessura visual da corda."),
      P("Restitution", "number", "Elasticidade ao esticar no comprimento máximo (0..1)."),
    ],
  }),
  SpringConstraint: C("Constraint", "Mola entre dois attachments.", {
    p: [
      P("Stiffness", "number", "Rigidez da mola."),
      P("Damping", "number", "Amortecimento da mola."),
      P("FreeLength", "number", "Comprimento de repouso."),
      P("MaxForce", "number", "Força máxima aplicada."),
      P("Radius", "number", "Raio visual da mola."),
      P("Coils", "number", "Número de voltas do desenho da mola no editor."),
    ],
  }),
  BallSocketConstraint: C("Constraint", "Junta esférica: rotação livre em torno de um ponto.", {
    p: [
      P("LimitsEnabled", "boolean", "Habilita o cone de limite."),
      P("UpperAngle", "number", "Ângulo máximo do cone (graus)."),
      P("TwistLimitsEnabled", "boolean", "Habilita limites de torção."),
      P("TwistLowerAngle", "number", "Limite inferior de torção (graus)."),
      P("TwistUpperAngle", "number", "Limite superior de torção (graus)."),
    ],
  }),


  BodyVelocity: C("Instance", "Aplica velocidade constante. Obsoleto: use LinearVelocity.", {
    deprecated: true,
    p: [
      P("Velocity", "Vector3", "Velocidade alvo."),
      P("MaxForce", "Vector3", "Força máxima por eixo."),
      P("P", "number", "Agressividade do controlador."),
    ],
  }),
  BodyForce: C("Instance", "Aplica força constante. Obsoleto: use VectorForce.", {
    deprecated: true,
    p: [P("Force", "Vector3", "Força aplicada no espaço do mundo.")],
  }),
  BodyPosition: C("Instance", "Move para uma posição alvo. Obsoleto: use AlignPosition.", {
    deprecated: true,
    p: [
      P("Position", "Vector3", "Posição alvo."),
      P("MaxForce", "Vector3", "Força máxima por eixo."),
      P("P", "number", "Agressividade do controlador."),
      P("D", "number", "Amortecimento do controlador."),
    ],
  }),
  BodyGyro: C("Instance", "Mantém uma orientação alvo. Obsoleto: use AlignOrientation.", {
    deprecated: true,
    p: [
      P("CFrame", "CFrame", "Orientação alvo."),
      P("MaxTorque", "Vector3", "Torque máximo por eixo."),
      P("P", "number", "Agressividade do controlador."),
      P("D", "number", "Amortecimento do controlador."),
    ],
  }),
  LinearVelocity: C("Constraint", "Aplica velocidade linear constante a um attachment.", {
    p: [
      P("VectorVelocity", "Vector3", "Velocidade alvo (modo Vector)."),
      P("MaxForce", "number", "Força máxima aplicada."),
      P("RelativeTo", "Enum.ActuatorRelativeTo", "Referencial da velocidade: World, Attachment0 ou Attachment1 (Parte 156)."),
    ],
  }),
  VectorForce: C("Constraint", "Aplica força constante a um attachment.", {
    p: [
      P("Force", "Vector3", "Força aplicada."),
      P("ApplyAtCenterOfMass", "boolean", "Aplica no centro de massa em vez do attachment."),
      P("RelativeTo", "Enum.ActuatorRelativeTo", "Referencial da força: World, Attachment0 ou Attachment1 (Parte 156)."),
    ],
  }),
  AlignPosition: C("Constraint", "Alinha a posição de um attachment a um alvo.", {
    p: [
      P("Position", "Vector3", "Posição alvo (modo OneAttachment)."),
      P("Mode", "Enum.PositionAlignmentMode", "OneAttachment ou TwoAttachment."),
      P("MaxForce", "number", "Força máxima aplicada."),
      P("Responsiveness", "number", "Quão rápido o alvo é alcançado."),
      P("MaxVelocity", "number", "Velocidade máxima ao mover em direção ao alvo (Parte 156)."),
      P("RigidityEnabled", "boolean", "Alinhamento rígido: teleporta cinematicamente ao alvo, ignorando força/responsividade (Parte 156)."),
    ],
  }),
  AlignOrientation: C("Constraint", "Alinha a orientação de um attachment a um alvo.", {
    p: [
      P("CFrame", "CFrame", "Orientação alvo (modo OneAttachment)."),
      P("Mode", "Enum.OrientationAlignmentMode", "OneAttachment ou TwoAttachment."),
      P("MaxTorque", "number", "Torque máximo aplicado."),
      P("Responsiveness", "number", "Quão rápido o alvo é alcançado."),
      P("MaxAngularVelocity", "number", "Velocidade angular máxima ao girar em direção ao alvo (Parte 156)."),
      P("RigidityEnabled", "boolean", "Alinhamento rígido: gira cinematicamente ao alvo, ignorando torque/responsividade (Parte 156)."),
    ],
  }),


  TweenService: C("Instance", "Serviço de interpolação suave de propriedades.", {
    service: true,
    m: [
      M("Create", [par("instance", "Instance"), par("tweenInfo", "TweenInfo"), par("propertyTable", "table")], "Tween", "Cria um Tween para animar as propriedades dadas."),
      M("GetValue", [par("alpha", "number"), par("easingStyle", "Enum.EasingStyle"), par("easingDirection", "Enum.EasingDirection")], "number", "Aplica easing a um alpha (0 a 1)."),
    ],
  }),
  TweenBase: C("Instance", "Base dos tweens em reprodução.", {
    p: [P("PlaybackState", "Enum.PlaybackState", "Estado atual da reprodução.", { readOnly: true })],
    m: [
      M("Play", [], "void", "Inicia ou retoma o tween."),
      M("Pause", [], "void", "Pausa o tween mantendo o progresso."),
      M("Cancel", [], "void", "Cancela o tween e reseta o progresso."),
    ],
    e: [E("Completed", [par("playbackState", "Enum.PlaybackState")], "Disparado quando o tween termina ou é cancelado.")],
  }),
  Tween: C("TweenBase", "Interpolação criada por TweenService:Create().", {
    p: [P("TweenInfo", "TweenInfo", "Parâmetros de tempo/easing do tween.", { readOnly: true })],
  }),
  RunService: C("Instance", "Serviço de eventos por frame e contexto de execução.", {
    service: true,
    m: [
      M("IsClient", [], "boolean", "True se o código roda no cliente."),
      M("IsServer", [], "boolean", "True se o código roda no servidor."),
      M("IsStudio", [], "boolean", "True se está rodando no Studio."),
      M("IsRunning", [], "boolean", "True se a simulação está rodando."),
      M("BindToRenderStep", [par("name", "string"), par("priority", "number"), par("callback", "function")], "void", "Executa a função a cada frame de render."),
      M("UnbindFromRenderStep", [par("name", "string")], "void", "Remove um bind de render step."),
    ],
    e: [
      E("Heartbeat", [par("deltaTime", "number")], "Disparado após a simulação física de cada frame."),
      E("RenderStepped", [par("deltaTime", "number")], "Disparado antes da renderização (apenas cliente)."),
      E("Stepped", [par("time", "number"), par("deltaTime", "number")], "Disparado antes da simulação física."),
      E("PreSimulation", [par("deltaTime", "number")], "Disparado antes da física (novo nome de Stepped)."),
      E("PostSimulation", [par("deltaTime", "number")], "Disparado depois da física (novo nome de Heartbeat)."),
    ],
  }),
  UserInputService: C("Instance", "Serviço de entrada (teclado, mouse, toque, gamepad). Apenas cliente.", {
    service: true,
    p: [
      P("KeyboardEnabled", "boolean", "Se há teclado disponível.", { readOnly: true }),
      P("MouseEnabled", "boolean", "Se há mouse disponível.", { readOnly: true }),
      P("TouchEnabled", "boolean", "Se há tela de toque disponível.", { readOnly: true }),
      P("GamepadEnabled", "boolean", "Se há gamepad conectado.", { readOnly: true }),
      P("MouseBehavior", "Enum.MouseBehavior", "Comportamento do cursor (Default, LockCenter...)."),
      P("MouseDeltaSensitivity", "number", "Sensibilidade do delta do mouse."),
    ],
    m: [
      M("IsKeyDown", [par("keyCode", "Enum.KeyCode")], "boolean", "True se a tecla está pressionada."),
      M("GetMouseLocation", [], "Vector2", "Posição atual do mouse na tela."),
      M("GetKeysPressed", [], "{ InputObject }", "Teclas atualmente pressionadas."),
    ],
    e: [
      E("InputBegan", [par("input", "InputObject"), par("gameProcessedEvent", "boolean")], "Disparado quando um input começa."),
      E("InputChanged", [par("input", "InputObject"), par("gameProcessedEvent", "boolean")], "Disparado quando um input muda (ex.: mouse move)."),
      E("InputEnded", [par("input", "InputObject"), par("gameProcessedEvent", "boolean")], "Disparado quando um input termina."),
      E("JumpRequest", [], "Disparado quando o jogador pede pulo (Espaço ou botão A do gamepad)."),
      E("TouchTap", [par("touchPositions", "{ Vector2 }"), par("gameProcessedEvent", "boolean")], "Disparado num toque rápido (tap) na tela, sem arrasto."),
    ],
  }),
  ContextActionService: C("Instance", "Liga ações nomeadas a inputs contextuais.", {
    service: true,
    m: [
      M("BindAction", [par("actionName", "string"), par("functionToBind", "function"), par("createTouchButton", "boolean"), par("...", "Enum.KeyCode | Enum.UserInputType", true)], "void", "Liga uma ação aos inputs dados."),
      M("BindActionAtPriority", [par("actionName", "string"), par("functionToBind", "function"), par("createTouchButton", "boolean"), par("priorityLevel", "number"), par("...", "Enum.KeyCode | Enum.UserInputType", true)], "void", "Liga uma ação com prioridade."),
      M("UnbindAction", [par("actionName", "string")], "void", "Remove uma ação ligada."),
      M("SetTitle", [par("actionName", "string"), par("title", "string")], "void", "Define o título do botão de toque de uma ação ligada."),
    ],
  }),
  CollectionService: C("Instance", "Sistema de tags para grupos de instâncias.", {
    service: true,
    m: [
      M("AddTag", [par("instance", "Instance"), par("tag", "string")], "void", "Adiciona uma tag à instância."),
      M("RemoveTag", [par("instance", "Instance"), par("tag", "string")], "void", "Remove uma tag da instância."),
      M("HasTag", [par("instance", "Instance"), par("tag", "string")], "boolean", "True se a instância tem a tag."),
      M("GetTagged", [par("tag", "string")], "{ Instance }", "Todas as instâncias com a tag."),
      M("GetTags", [par("instance", "Instance")], "{ string }", "Tags da instância."),
      M("GetAllTags", [], "{ string }", "Todas as tags em uso no jogo."),
      M("GetInstanceAddedSignal", [par("tag", "string")], "RBXScriptSignal", "Sinal disparado quando a tag é adicionada a algo."),
      M("GetInstanceRemovedSignal", [par("tag", "string")], "RBXScriptSignal", "Sinal disparado quando a tag é removida de algo."),
    ],
  }),
  PhysicsService: C("Instance", "Gerencia grupos de colisão.", {
    service: true,
    m: [
      M("RegisterCollisionGroup", [par("name", "string")], "void", "Registra um novo grupo de colisão."),
      M("UnregisterCollisionGroup", [par("name", "string")], "void", "Remove um grupo de colisão."),
      M("CollisionGroupSetCollidable", [par("name1", "string"), par("name2", "string"), par("collidable", "boolean")], "void", "Define se dois grupos colidem."),
      M("CollisionGroupsAreCollidable", [par("name1", "string"), par("name2", "string")], "boolean", "True se os grupos colidem entre si."),
      M("GetRegisteredCollisionGroups", [], "{ table }", "Lista os grupos registrados."),
    ],
  }),

  DataStoreService: C("Instance", "Persistência de dados entre sessões de Playtest (Server-only, via IndexedDB).", {
    service: true,
    m: [
      M("GetDataStore", [par("name", "string"), par("scope", "string", true)], "GlobalDataStore", "Retorna um GlobalDataStore pelo nome (scope padrão \"global\")."),
      M("GetGlobalDataStore", [], "GlobalDataStore", "Retorna o DataStore global padrão do jogo."),
      M("GetOrderedDataStore", [par("name", "string"), par("scope", "string", true)], "OrderedDataStore", "Retorna um OrderedDataStore (valores inteiros, ordenáveis)."),
      M("GetRequestBudgetForRequestType", [par("requestType", "string")], "number", "Orçamento atual de requisições para o tipo informado."),
    ],
  }),
  GlobalDataStore: C("Instance", "Armazena valores persistentes por chave. Métodos assíncronos (yield).", {
    m: [
      M("GetAsync", [par("key", "string")], "Variant", "Retorna o valor salvo na chave, ou nil."),
      M("SetAsync", [par("key", "string"), par("value", "Variant"), par("userIds", "{ number }", true), par("options", "Variant", true)], "string", "Salva o valor e retorna o version id."),
      M("UpdateAsync", [par("key", "string"), par("transformFunction", "function")], "Variant", "Lê, transforma e salva atomicamente. Retornar nil cancela."),
      M("IncrementAsync", [par("key", "string"), par("delta", "number", true)], "number", "Incrementa um valor numérico e retorna o novo total."),
      M("RemoveAsync", [par("key", "string")], "Variant", "Remove a chave e retorna o último valor."),
      M("ListKeysAsync", [par("prefix", "string", true), par("pageSize", "number", true)], "DataStoreKeyPages", "Lista chaves (paginadas) por prefixo."),
    ],
  }),
  OrderedDataStore: C("GlobalDataStore", "DataStore de inteiros não-negativos com ordenação (ex.: leaderboard global).", {
    m: [
      M("GetSortedAsync", [par("ascending", "boolean"), par("pageSize", "number"), par("minValue", "number", true), par("maxValue", "number", true)], "DataStorePages", "Retorna páginas ordenadas de pares chave/valor."),
    ],
  }),
  DataStorePages: C("Instance", "Páginas ordenadas retornadas por GetSortedAsync.", {
    p: [
      P("IsFinished", "boolean", "True quando não há mais páginas.", { readOnly: true }),
    ],
    m: [
      M("GetCurrentPage", [], "{ table }", "Array de { key, value } da página atual."),
      M("AdvanceToNextPageAsync", [], "void", "Avança para a próxima página (yield)."),
    ],
  }),
  DataStoreKeyPages: C("Instance", "Páginas de chaves retornadas por ListKeysAsync.", {
    p: [
      P("IsFinished", "boolean", "True quando não há mais páginas.", { readOnly: true }),
    ],
    m: [
      M("GetCurrentPage", [], "{ table }", "Array de { KeyName } da página atual."),
      M("AdvanceToNextPageAsync", [], "void", "Avança para a próxima página (yield)."),
    ],
  }),
  HttpService: C("Instance", "Requisições HTTP simuladas (Mock) + utilidades JSON reais.", {
    service: true,
    p: [
      P("HttpEnabled", "boolean", "Permite requisições HTTP (controlado por Game Settings > Security).", { category: "Behavior" }),
    ],
    m: [
      M("JSONEncode", [par("input", "Variant")], "string", "Converte uma tabela Luau em string JSON."),
      M("JSONDecode", [par("input", "string")], "Variant", "Converte uma string JSON em tabela Luau."),
      M("GenerateGUID", [par("wrapInCurlyBraces", "boolean", true)], "string", "Gera um GUID v4."),
      M("UrlEncode", [par("input", "string")], "string", "Percent-encoding de uma string para URL."),
      M("GetAsync", [par("url", "string"), par("nocache", "boolean", true), par("headers", "Variant", true)], "string", "GET simulado (usa o Mock HTTP)."),
      M("PostAsync", [par("url", "string"), par("data", "string"), par("contentType", "Variant", true), par("compress", "boolean", true), par("headers", "Variant", true)], "string", "POST simulado (usa o Mock HTTP)."),
      M("RequestAsync", [par("requestOptions", "Variant")], "Variant", "Requisição simulada; retorna { Success, StatusCode, StatusMessage, Headers, Body }."),
    ],
  }),
  MessagingService: C("Instance", "Pub/sub entre servidores (simulado localmente). Server-only.", {
    service: true,
    m: [
      M("SubscribeAsync", [par("topic", "string"), par("callback", "function")], "RBXScriptConnection", "Inscreve em um tópico; o callback recebe { Data, Sent }."),
      M("PublishAsync", [par("topic", "string"), par("message", "Variant")], "void", "Publica uma mensagem no tópico."),
    ],
  }),
  TeleportService: C("Instance", "Placeholder funcional de teleporte entre places (apenas simula o fluxo).", {
    service: true,
    m: [
      M("Teleport", [par("placeId", "number"), par("player", "Instance", true)], "void", "Teleporte simulado (log no Output)."),
      M("TeleportAsync", [par("placeId", "number"), par("players", "{ Instance }"), par("options", "Variant", true)], "void", "Teleporte simulado de múltiplos jogadores."),
      M("GetLocalPlayerTeleportData", [], "Variant", "Dados de teleporte simulados (ou nil)."),
    ],
    e: [
      E("TeleportInitFailed", [par("player", "Instance"), par("teleportResult", "Variant"), par("errorMessage", "string")], "Disparado quando um teleporte falha (testes de erro)."),
    ],
  }),


  PathfindingService: C("Instance", "Calcula caminhos (A*) pela navmesh do Workspace para NPCs. Server-side.", {
    service: true,
    m: [
      M("CreatePath", [par("agentParameters", "Variant", true)], "Path", "Cria um Path com parâmetros do agente: { AgentRadius=2, AgentHeight=5, AgentCanJump=true, AgentCanClimb=false, AgentJumpHeight=7, AgentMaxSlope=45, WaypointSpacing=4, Costs={ Material/Label = custo } }. Parte 135: AgentDynamicAvoidance=true (considera obstáculos dinâmicos do navmesh), AgentAutoRepath=false (quando true, replaneja sozinho ao ser bloqueado), AgentRepathCooldown=0.25 (segundos mínimos entre replanejamentos, clamp 0.05–10, anti-exploit) e AgentPredictSeconds=0 (janela de previsão do movimento do obstáculo, clamp 0–2)."),
      M("FindPathAsync", [par("start", "Vector3"), par("finish", "Vector3")], "Path", "Legado: cria e computa um Path entre dois pontos (yield)."),
    ],
  }),
  Path: C("Instance", "Resultado de um cálculo de caminho. Contém waypoints e o Status.", {
    p: [
      P("Status", "Enum.PathStatus", "Resultado do último ComputeAsync (Success, NoPath, ClosestNoPath, etc.).", { readOnly: true }),
      P("IsDynamic", "boolean", "Extensão do projeto (Parte 135): true quando o Path considera obstáculos dinâmicos e participa do replanejamento automático.", { readOnly: true }),
      P("RepathCount", "number", "Extensão do projeto (Parte 135): total de replanejamentos automáticos já aplicados a este Path.", { readOnly: true }),
    ],
    m: [
      M("ComputeAsync", [par("start", "Vector3"), par("finish", "Vector3")], "void", "Calcula o caminho entre start e finish (yield). Atualiza Status."),
      M("GetWaypoints", [], "{ PathWaypoint }", "Retorna o array de PathWaypoint do caminho calculado."),
      M("CheckOcclusionAsync", [par("start", "number")], "number", "Índice do primeiro waypoint bloqueado a partir de start, ou -1 (yield)."),
    ],
    e: [
      E("Blocked", [par("blockedWaypointIdx", "number")], "Disparado quando o caminho ativo é bloqueado em um waypoint."),
      E("Unblocked", [par("unblockedWaypointIdx", "number")], "Disparado quando um bloqueio no caminho ativo é removido."),
      E("Recomputed", [par("reason", "string"), par("waypointCount", "number")], "Extensão do projeto (Parte 135): disparado após o replanejamento automático do caminho (auto-repath), com o motivo e o novo total de waypoints."),
    ],
  }),
  PathWaypoint: C("Instance", "Ponto imutável de um caminho: posição, ação e label.", {
    p: [
      P("Position", "Vector3", "Posição do waypoint no mundo.", { readOnly: true }),
      P("Action", "Enum.PathWaypointAction", "Ação no waypoint (Walk, Jump, Custom).", { readOnly: true }),
      P("Label", "string", "Label associado (de um PathfindingLink, quando Action=Custom).", { readOnly: true }),
    ],
  }),
  PathfindingModifier: C("Instance", "Filho de uma BasePart: ajusta o custo de atravessar a região da parte.", {
    p: [
      P("PassThrough", "boolean", "Se false, agentes não podem atravessar a região de forma alguma.", { category: "Behavior" }),
      P("Label", "string", "Chave usada na tabela Costs do agente para definir o custo da região.", { category: "Data" }),
    ],
  }),
  PathfindingLink: C("Instance", "Conexão de travessia entre dois Attachments (ex.: pulo, escada, tirolesa).", {
    p: [
      P("Attachment0", "Instance", "Primeiro ponto de conexão do link.", { category: "Data" }),
      P("Attachment1", "Instance", "Segundo ponto de conexão do link.", { category: "Data" }),
      P("Label", "string", "Label aplicado ao waypoint Custom gerado e usado na tabela Costs.", { category: "Data" }),
      P("IsBidirectional", "boolean", "Se true, o link pode ser atravessado nos dois sentidos.", { category: "Behavior" }),
    ],
  }),


  Folder: C("Instance", "Contêiner simples para organizar objetos.", {}),
  Configuration: C("Instance", "Contêiner para objetos Value de configuração.", {}),
  ReplicatedStorage: C("Instance", "Armazenamento replicado para servidor e clientes.", { service: true }),
  ServerStorage: C("Instance", "Armazenamento visível apenas no servidor.", { service: true }),
  ServerScriptService: C("Instance", "Contêiner de Scripts do servidor.", { service: true }),
  StarterGui: C("Instance", "GUIs copiadas para o PlayerGui de cada jogador.", {
    service: true,
    p: [
      P("ScreenOrientation", "Enum.ScreenOrientation", "Orientação de tela padrão."),
      P("ShowDevelopmentGui", "boolean", "Mostra GUIs de desenvolvimento."),
      P("ResetPlayerGuiOnSpawn", "boolean", "Re-clona o PlayerGui a cada respawn por padrão."),
    ],
    m: [
      M("SetCoreGuiEnabled", [par("coreGuiType", "Enum.CoreGuiType"), par("enabled", "boolean")], "void", "Mostra/oculta UIs nativas (Chat, PlayerList, Backpack, Health)."),
      M("GetCoreGuiEnabled", [par("coreGuiType", "Enum.CoreGuiType")], "boolean", "Estado de uma UI nativa."),
      M("SetCore", [par("parameterName", "string"), par("value", "any")], "void", "Customiza a core UI (placeholder)."),
      M("GetCore", [par("parameterName", "string")], "any", "Lê um parâmetro da core UI (placeholder)."),
    ],
  }),
  StarterPack: C("Instance", "Tools copiadas para o Backpack de cada jogador.", { service: true }),
  StarterPlayer: C("Instance", "Configurações e scripts iniciais dos jogadores.", {
    service: true,
    p: [
      P("CameraMode", "Enum.CameraMode", "Classic ou LockFirstPerson (1ª pessoa travada)."),
      P("CameraMinZoomDistance", "number", "Zoom mínimo da câmera do jogador (studs)."),
      P("CameraMaxZoomDistance", "number", "Zoom máximo da câmera do jogador (studs)."),
      P("DevCameraOcclusionMode", "Enum.DevCameraOcclusionMode", "Como a câmera trata obstruções (Zoom/Invisicam)."),
      P("CharacterWalkSpeed", "number", "WalkSpeed inicial dos personagens."),
      P("CharacterJumpPower", "number", "JumpPower inicial dos personagens."),
      P("CharacterJumpHeight", "number", "JumpHeight inicial dos personagens."),
      P("CharacterUseJumpPower", "boolean", "true: personagens usam JumpPower no pulo; false: usam JumpHeight. Parte 148."),
    ],
  }),
  StarterPlayerScripts: C("Instance", "LocalScripts copiados para cada jogador.", {}),
  StarterCharacterScripts: C("Instance", "Scripts copiados para cada personagem.", {}),


  ValueBase: C("Instance", "Base dos objetos que armazenam um valor.", {
    e: [E("Changed", [par("value", "any")], "Disparado quando Value muda (passa o novo valor).")],
  }),
  StringValue: C("ValueBase", "Armazena uma string.", {
    p: [P("Value", "string", "O valor armazenado.")],
  }),
  IntValue: C("ValueBase", "Armazena um número inteiro (64 bits).", {
    p: [P("Value", "number", "O valor armazenado.")],
  }),
  NumberValue: C("ValueBase", "Armazena um número de ponto flutuante.", {
    p: [P("Value", "number", "O valor armazenado.")],
  }),
  BoolValue: C("ValueBase", "Armazena um booleano.", {
    p: [P("Value", "boolean", "O valor armazenado.")],
  }),
  ObjectValue: C("ValueBase", "Armazena uma referência a outra Instance.", {
    p: [P("Value", "Instance", "A instância referenciada.")],
  }),
  Color3Value: C("ValueBase", "Armazena um Color3.", {
    p: [P("Value", "Color3", "O valor armazenado.")],
  }),
  Vector3Value: C("ValueBase", "Armazena um Vector3.", {
    p: [P("Value", "Vector3", "O valor armazenado.")],
  }),
  CFrameValue: C("ValueBase", "Armazena um CFrame.", {
    p: [P("Value", "CFrame", "O valor armazenado.")],
  }),
  RayValue: C("ValueBase", "Armazena um Ray.", {
    p: [P("Value", "Ray", "O valor armazenado.")],
  }),
  IntConstrainedValue: C("ValueBase", "Inteiro limitado a um intervalo. Obsoleto.", {
    deprecated: true,
    p: [
      P("Value", "number", "O valor armazenado (limitado)."),
      P("MinValue", "number", "Valor mínimo permitido."),
      P("MaxValue", "number", "Valor máximo permitido."),
    ],
  }),
  DoubleConstrainedValue: C("ValueBase", "Número limitado a um intervalo. Obsoleto.", {
    deprecated: true,
    p: [
      P("Value", "number", "O valor armazenado (limitado)."),
      P("MinValue", "number", "Valor mínimo permitido."),
      P("MaxValue", "number", "Valor máximo permitido."),
    ],
  }),


  Light: C("Instance", "Base das fontes de luz dinâmicas.", {
    p: [
      P("Brightness", "number", "Intensidade da luz. Com Lighting.LightPhotometry ligada (IL-F27) vira LÚMENS reais: 800 lm por unidade (1 ≈ bulbo 60 W); a candela sai da abertura do cone."),
      P("Color", "Color3", "Cor da luz."),
      P("Enabled", "boolean", "Se a luz está acesa."),
      P("LightPreset", "string", "IL-F27: preset fotométrico real — None (manual), Candle (1900 K/12 lm), Tungsten (2700 K/800 lm), Halogen (3000 K/1600 lm), LED (4000 K/800 lm), Fluorescent (5000 K/1100 lm), Sodium (2200 K/6000 lm), Daylight (6500 K/1600 lm). Sobrepõe Temperature/Brightness quando a fotometria está ligada."),
      P("Shadows", "boolean", "Se a luz projeta sombras."),
      P("Temperature", "number", "IL-F27: temperatura de cor em Kelvin (1000–12000; 0 = desligada). Tint fisicamente correto da tabela Planck multiplicando a Color, com luminância preservada. Efetiva com Lighting.LightPhotometry ligada."),
    ],
  }),
  PointLight: C("Light", "Luz pontual que emite em todas as direções.", {
    p: [
      P("Range", "number", "Alcance da luz em studs."),
      P("SourceRadius", "number", "Raio da esfera emissora em studs (0 = pontual). Amacia a penumbra das sombras PCSS (IL-F25)."),
      P("SoftSourceRadius", "number", "LL-F4: raio EXTRA que só amacia o difuso, sem aumentar a fonte (0 = sem efeito, byte a byte)."),
      P("SourceLength", "number", "LL-F4: comprimento da CÁPSULA emissora em studs — estica a esfera num tubo (0 = esfera pontual)."),
      P("FilterSharpen", "number", "LL-F14: encolhe a largura da penumbra, 0–1. 0 (padrão) = penumbra física cheia pelo tamanho da fonte; 1 = sombra dura."),
      P("ShadowSlopeBias", "number", "LL-F14: bias por INCLINAÇÃO da superfície (0–7,5 em passos de 0,5). Tira o acne de parede em ângulo raso sem descolar a sombra do objeto. 0 (padrão) = sem bias extra."),
      P("ContactShadowLength", "number", "LL-F15: comprimento em studs da marcha curta no depth que fecha a fresta que o shadow map não resolve (pé de cadeira, parafuso). 0 (padrão) = desligada; teto 8 studs."),
      P("IesProfile", "string", "IL-F26: perfil IES (LM-63) — preset: downlight, spotnarrow, street, wallwash — ou Asset ID de .ies local. Vazio = sem efeito (Classic byte a byte)."),
      P("Intensity", "number", "LL-F3: intensidade ABSOLUTA na unidade de IntensityUnits (lumens, candela ou EV100). 0 = mantém a rampa de Brightness legada, byte a byte."),
      P("IntensityUnits", "string", "LL-F3: unidade de Intensity — unitless (padrão, legado), lumens, candela ou ev. A conversão usa a ABERTURA REAL da luz."),
      P("UseIESBrightness", "boolean", "LL-F3: deixa o perfil IES mandar a intensidade absoluta (candela de pico do arquivo). Exige IesProfile preenchido."),
      P("IESBrightnessScale", "number", "LL-F3: multiplica a candela vinda do perfil IES quando UseIESBrightness está ligado (0–100, padrão 1)."),
    ],
  }),
  RectLight: C("Light", "Luz de ÁREA retangular (LTC) — softbox/letreiro/janela com reflexo alongado real (IL-F25; exclusiva da engine, não existe no Roblox).", {
    p: [
      P("Face", "Enum.NormalId", "Face da parte de onde o retângulo emite."),
      P("Height", "number", "Altura do retângulo emissor em studs."),
      P("Range", "number", "Alcance em studs (usado pelo fallback point e por fog/partículas)."),
      P("Width", "number", "Largura do retângulo emissor em studs."),
      P("BarnDoorAngle", "number", "LL-F7: ângulo das portas (barn doors) em graus, 0–90. 90 (padrão) = porta deitada no plano da luz, não corta nada — byte a byte. Fechar o ângulo recorta o feixe pelos dois eixos do retângulo, como no UE."),
      P("BarnDoorLength", "number", "LL-F7: comprimento das abas das portas em studs (0 = sem aba, padrão). Aba mais longa fecha o feixe mais perto da fonte."),
      P("SourceTexture", "string", "LL-F7: gel/textura da fonte — a cor MÉDIA dela tinge o reflexo alongado (TV colorida, vitral). Presets: tv-colorbars, window-grid, softbox-gradient, gel-warm, gel-cool. Vazio (padrão) = tinta branca."),
      P("TwoSided", "boolean", "LL-F7: emite pelas DUAS faces do retângulo (letreiro visto dos dois lados). false (padrão) = uma face só, como antes."),
    ],
  }),

  TubeLight: C("Light", "Luz de ÁREA tubular (LTC) — néon/fluorescente com reflexo linear real (IL-F37; exclusiva da engine).", {
    p: [
      P("Face", "Enum.NormalId", "Face da parte de onde o tubo emite."),
      P("Length", "number", "Comprimento do tubo em studs."),
      P("Range", "number", "Alcance em studs (fallback point e fog/partículas)."),
      P("TubeRadius", "number", "Raio do tubo em studs (controla espessura do highlight)."),
      P("BarnDoorAngle", "number", "LL-F7: ângulo das portas (barn doors) em graus, 0–90. 90 (padrão) = neutro, byte a byte. Vale também para o 2º painel cruzado do tubo."),
      P("BarnDoorLength", "number", "LL-F7: comprimento das abas das portas em studs (0 = sem aba, padrão)."),
      P("SourceTexture", "string", "LL-F7: gel/textura da fonte — a cor MÉDIA tinge o reflexo linear. Presets: tv-colorbars, window-grid, softbox-gradient, gel-warm, gel-cool. Vazio (padrão) = tinta branca."),
      P("TwoSided", "boolean", "LL-F7: emite pelas duas faces (néon visto dos dois lados). false (padrão) = uma face só."),
    ],
  }),
  SpotLight: C("Light", "Luz cônica direcionada (lanterna).", {
    p: [
      P("Range", "number", "Alcance da luz em studs."),
      P("Angle", "number", "Ângulo do cone em graus."),
      P("Face", "Enum.NormalId", "Face da parte de onde a luz emite."),
      P("SourceRadius", "number", "Raio do disco emissor em studs (0 = pontual). Amacia a penumbra das sombras PCSS (IL-F25)."),
      P("SoftSourceRadius", "number", "LL-F4: raio EXTRA que só amacia o difuso, sem aumentar a fonte (0 = sem efeito, byte a byte)."),
      P("SourceLength", "number", "LL-F4: comprimento da CÁPSULA emissora em studs — estica a esfera num tubo (0 = esfera pontual)."),
      P("FilterSharpen", "number", "LL-F14: encolhe a largura da penumbra, 0–1. 0 (padrão) = penumbra física cheia pelo tamanho da fonte; 1 = sombra dura. O spot é quem mais usa a fase."),
      P("ShadowSlopeBias", "number", "LL-F14: bias por INCLINAÇÃO da superfície (0–7,5 em passos de 0,5). Tira o acne sem descolar a sombra. 0 (padrão) = sem bias extra."),
      P("ContactShadowLength", "number", "LL-F15: comprimento em studs da marcha curta no depth que fecha a fresta que o shadow map não resolve. 0 (padrão) = desligada; teto 8 studs."),
      P("IesProfile", "string", "IL-F26: perfil IES (LM-63) — preset: downlight, spotnarrow, street, wallwash — ou Asset ID de .ies local."),
      P("LightFunction", "string", "IL-F26: cookie/gobo projetado pelo spot — preset: window, blinds, foliage, grid — ou Asset ID de imagem local (png/jpg)."),
      P("LightFunctionRotation", "number", "IL-F26: rotação do cookie em graus (0–360)."),
      P("Intensity", "number", "LL-F3: intensidade ABSOLUTA na unidade de IntensityUnits (lumens, candela ou EV100). 0 = mantém a rampa de Brightness legada, byte a byte."),
      P("IntensityUnits", "string", "LL-F3: unidade de Intensity — unitless (padrão, legado), lumens, candela ou ev. A conversão usa a ABERTURA REAL do cone."),
      P("UseIESBrightness", "boolean", "LL-F3: deixa o perfil IES mandar a intensidade absoluta (candela de pico do arquivo). Exige IesProfile preenchido."),
      P("IESBrightnessScale", "number", "LL-F3: multiplica a candela vinda do perfil IES quando UseIESBrightness está ligado (0–100, padrão 1)."),
    ],
  }),
  SurfaceLight: C("Light", "Luz emitida por toda uma face da parte.", {
    p: [
      P("Range", "number", "Alcance da luz em studs."),
      P("Angle", "number", "Ângulo de abertura em graus."),
      P("Face", "Enum.NormalId", "Face da parte que emite a luz."),
      P("IesProfile", "string", "IL-F26: perfil IES (LM-63) — preset: downlight, spotnarrow, street, wallwash — ou Asset ID de .ies local."),
      P("LightFunction", "string", "IL-F26: cookie/gobo projetado — preset: window, blinds, foliage, grid — ou Asset ID de imagem local."),
      P("LightFunctionRotation", "number", "IL-F26: rotação do cookie em graus (0–360)."),
      P("Intensity", "number", "LL-F3: intensidade ABSOLUTA na unidade de IntensityUnits (lumens, candela ou EV100). 0 = mantém a rampa de Brightness legada, byte a byte."),
      P("IntensityUnits", "string", "LL-F3: unidade de Intensity — unitless (padrão, legado), lumens, candela ou ev. A conversão usa a ABERTURA REAL da face."),
      P("UseIESBrightness", "boolean", "LL-F3: deixa o perfil IES mandar a intensidade absoluta (candela de pico do arquivo). Exige IesProfile preenchido."),
      P("IESBrightnessScale", "number", "LL-F3: multiplica a candela vinda do perfil IES quando UseIESBrightness está ligado (0–100, padrão 1)."),
    ],
  }),


  PostEffect: C("Instance", "Base dos efeitos de pós-processamento (filhos de Lighting/Camera).", {
    p: [P("Enabled", "boolean", "Se o efeito está ativo.")],
  }),
  BlurEffect: C("PostEffect", "Desfoque gaussiano da tela.", {
    p: [P("Size", "number", "Intensidade do desfoque (0 a 56).")],
  }),
  BloomEffect: C("PostEffect", "Brilho difuso em áreas claras.", {
    p: [
      P("Intensity", "number", "Intensidade do bloom. No modo Energy também dita a fração espalhada (scatter ≈ 5% por unidade, teto 20%)."),
      P("Size", "number", "Tamanho do espalhamento."),
      P("Threshold", "number", "Brilho mínimo que ativa o efeito (só no modo Classic; o modo Energy é físico e não usa threshold)."),
      P("Mode", "string", "IL-F29: 'Classic' (default, bloom atual byte a byte) ou 'Energy' — bloom físico por energia: threshold 0 com knee suave (sem gate visível), pesos por mip conservando energia (a cena cede ~4-7% e recebe o mesmo de volta espalhado), MESMO custo/mips do Classic."),
      P("Anamorphic", "number", "IL-F29 (só modo Energy): esticamento horizontal do halo (scale X do blur), 1 a 3; 1 = desligado."),
      P("Dirt", "number", "IL-F29 (só modo Energy): lens dirt procedural sutil multiplicando o termo espalhado, 0 a 1; 0 = desligado (zero textura)."),
    ],
  }),
  ColorCorrectionEffect: C("PostEffect", "Ajustes globais de cor da cena.", {
    p: [
      P("Brightness", "number", "Brilho adicional (-1 a 1)."),
      P("Contrast", "number", "Contraste adicional (-1 a 1)."),
      P("Saturation", "number", "Saturação adicional (-1 a 1)."),
      P("TintColor", "Color3", "Cor multiplicada sobre a cena."),
    ],
  }),
  DepthOfFieldEffect: C("PostEffect", "Desfoque por distância (profundidade de campo).", {
    p: [
      P("FarIntensity", "number", "Intensidade do desfoque distante."),
      P("FocusDistance", "number", "Distância do plano em foco."),
      P("InFocusRadius", "number", "Raio ao redor do foco sem desfoque."),
      P("NearIntensity", "number", "Intensidade do desfoque próximo."),
    ],
  }),
  SunRaysEffect: C("PostEffect", "Raios de luz vindos do sol.", {
    p: [
      P("Intensity", "number", "Opacidade dos raios."),
      P("Spread", "number", "Espalhamento dos raios."),
    ],
  }),
  LocalizationService: C("Instance", "Servi\u00e7o de localiza\u00e7\u00e3o: locales do jogador, Translators e tradu\u00e7\u00e3o autom\u00e1tica de GUIs durante o Playtest.", {
    service: true,
    p: [
      P("RobloxLocaleId", "string", 'Locale do Roblox para o jogador atual (ex.: "en-us").', { readOnly: true }),
      P("SystemLocaleId", "string", "Locale do sistema detectado do navegador.", { readOnly: true }),
    ],
    m: [
      M("GetTranslatorForPlayer", [par("player", "Player")], "Translator", "Retorna um Translator configurado para o locale do Player."),
      M("GetTranslatorForPlayerAsync", [par("player", "Player")], "Translator", "Vers\u00e3o async de GetTranslatorForPlayer."),
      M("GetTranslatorForLocaleAsync", [par("localeId", "string")], "Translator", "Retorna um Translator para um locale espec\u00edfico."),
      M("GetTableEntries", [par("instance", "Instance", true)], "table", "Retorna as entries de localiza\u00e7\u00e3o que se aplicam \u00e0 inst\u00e2ncia."),
      M("GetCountryRegionForPlayerAsync", [par("player", "Player")], "string", 'Retorna o c\u00f3digo de regi\u00e3o simulado do jogador (ex.: "US", "BR").'),
      M("PromptGamePassPurchase", [], "void", "Placeholder sem efeito nesta vers\u00e3o."),
    ],
    e: [
      E("AutoTranslateWillRun", [par("gui", "Instance")], "Disparado antes da tradu\u00e7\u00e3o autom\u00e1tica de uma GUI."),
    ],
  }),

  LocalizationTable: C("Instance", "Tabela de tradu\u00e7\u00f5es com entries (Key, Source, Context, Example e Values por locale).", {
    p: [
      P("SourceLocaleId", "string", 'Locale fonte dos textos (padr\u00e3o "en-us").'),
      P("DevelopmentLanguageCode", "string", "Alias de SourceLocaleId para compatibilidade."),
    ],
    m: [
      M("GetEntries", [], "table", "Retorna um array com todas as entries da tabela."),
      M("SetEntries", [par("entries", "table")], "void", "Substitui todas as entries da tabela de uma vez."),
      M("GetTranslator", [par("localeId", "string")], "Translator", "Retorna um Translator baseado apenas nesta tabela."),
      M("SetEntry", [par("key", "string"), par("source", "string"), par("context", "string"), par("localeId", "string"), par("text", "string")], "void", "Define ou atualiza a tradu\u00e7\u00e3o de uma entry para um locale."),
      M("RemoveEntry", [par("key", "string"), par("source", "string"), par("context", "string")], "void", "Remove uma entry da tabela."),
      M("RemoveTargetLocale", [par("localeId", "string")], "void", "Remove todas as tradu\u00e7\u00f5es de um locale."),
    ],
  }),

  Translator: C("Instance", "Obt\u00e9m tradu\u00e7\u00f5es em tempo de execu\u00e7\u00e3o para um locale espec\u00edfico.", {
    p: [
      P("LocaleId", "string", "Locale alvo deste Translator.", { readOnly: true }),
    ],
    m: [
      M("Translate", [par("context", "Instance"), par("text", "string")], "string", "Traduz o texto no contexto da inst\u00e2ncia; retorna o original se n\u00e3o houver tradu\u00e7\u00e3o."),
      M("FormatByKey", [par("key", "string"), par("args", "table", true)], "string", "Busca a tradu\u00e7\u00e3o pela Key e substitui par\u00e2metros ({1:int}, {name}, ...). Lan\u00e7a erro se a key n\u00e3o existir ou faltarem argumentos."),
      M("RobloxOnlyTranslate", [par("context", "Instance"), par("text", "string")], "string", "Equivalente a Translate."),
    ],
  }),
};





export const CLASS_ALIASES = {
  LocalPlayer: "Player",
  Character: "Model",
};


function deepFreeze(obj) {
  if (!obj || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) deepFreeze(obj[key]);
  return obj;
}
deepFreeze(API_CLASSES);
deepFreeze(CLASS_ALIASES);
