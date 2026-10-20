function ex(title, code) {
  return Object.freeze({ title, code });
}

export const API_EXAMPLES = Object.freeze({
  Instance: [
    ex("Create a new instance", 'local part = Instance.new("Part")\npart.Parent = workspace'),
    ex("Find a child by name", 'local child = workspace:FindFirstChild("SpawnLocation")\nif child then\n\tprint(child.Name)\nend'),
    ex("Wait for a child", 'local hrp = character:WaitForChild("HumanoidRootPart")\nprint(hrp.Position)'),
    ex("Listen for new children", 'workspace.ChildAdded:Connect(function(child)\n\tprint("Added:", child.Name)\nend)'),
  ],
  Part: [
    ex("Create a red part", 'local part = Instance.new("Part")\npart.Size = Vector3.new(4, 1, 4)\npart.Color = Color3.fromRGB(255, 0, 0)\npart.Anchored = true\npart.Parent = workspace'),
    ex("Detect touches", 'part.Touched:Connect(function(hit)\n\tlocal humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")\n\tif humanoid then\n\t\thumanoid:TakeDamage(10)\n\tend\nend)'),
    ex("Move a part smoothly", 'for i = 1, 50 do\n\tpart.CFrame = part.CFrame * CFrame.new(0, 0.1, 0)\n\ttask.wait(0.03)\nend'),
  ],
  Model: [
    ex("Move a whole model", 'local model = workspace.House\nmodel:MoveTo(Vector3.new(0, 10, 0))'),
    ex("Get the model bounds", 'local cf, size = model:GetBoundingBox()\nprint("Center:", cf.Position, "Size:", size)'),
  ],
  Workspace: [
    ex("Iterate over parts", 'for _, obj in ipairs(workspace:GetDescendants()) do\n\tif obj:IsA("BasePart") then\n\t\tprint(obj.Name)\n\tend\nend'),
    ex("Raycast from a point", 'local result = workspace:Raycast(Vector3.new(0, 50, 0), Vector3.new(0, -100, 0))\nif result then\n\tprint("Hit:", result.Instance.Name)\nend'),
  ],
  Humanoid: [
    ex("Change walk speed", 'local humanoid = character:FindFirstChildOfClass("Humanoid")\nhumanoid.WalkSpeed = 24'),
    ex("React to death", 'humanoid.Died:Connect(function()\n\tprint("Player died!")\nend)'),
    ex("Make the character jump", 'humanoid.Jump = true'),
  ],
  Players: [
    ex("Greet joining players", 'game.Players.PlayerAdded:Connect(function(player)\n\tprint("Welcome, " .. player.Name)\nend)'),
    ex("Loop through players", 'for _, player in ipairs(game.Players:GetPlayers()) do\n\tprint(player.Name)\nend'),
  ],
  Player: [
    ex("Get the character", 'local character = player.Character or player.CharacterAdded:Wait()\nprint(character.Name)'),
    ex("Kick a player", 'player:Kick("Breaking the rules")'),
  ],
  RemoteEvent: [
    ex("Fire from client", '-- LocalScript\nlocal remote = game.ReplicatedStorage.MyRemote\nremote:FireServer("hello")'),
    ex("Listen on server", '-- Script\nlocal remote = game.ReplicatedStorage.MyRemote\nremote.OnServerEvent:Connect(function(player, message)\n\tprint(player.Name, "sent:", message)\nend)'),
  ],
  RemoteFunction: [
    ex("Invoke from client", '-- LocalScript\nlocal rf = game.ReplicatedStorage.GetCoins\nlocal coins = rf:InvokeServer()\nprint("Coins:", coins)'),
  ],
  BindableEvent: [
    ex("Signal between scripts", 'local event = script.Parent.MyEvent\nevent.Event:Connect(function(value)\n\tprint("Received:", value)\nend)\nevent:Fire(42)'),
  ],
  TweenService: [
    ex("Tween a part's position", 'local TweenService = game:GetService("TweenService")\nlocal info = TweenInfo.new(2, Enum.EasingStyle.Quad)\nlocal tween = TweenService:Create(part, info, { Position = Vector3.new(0, 20, 0) })\ntween:Play()'),
    ex("Fade out a part", 'local tween = TweenService:Create(part, TweenInfo.new(1), { Transparency = 1 })\ntween.Completed:Connect(function()\n\tpart:Destroy()\nend)\ntween:Play()'),
  ],
  RunService: [
    ex("Run code every frame", 'local RunService = game:GetService("RunService")\nRunService.Heartbeat:Connect(function(dt)\n\tpart.CFrame = part.CFrame * CFrame.Angles(0, dt, 0)\nend)'),
    ex("Check the context", 'if RunService:IsServer() then\n\tprint("Running on the server")\nend'),
  ],
  UserInputService: [
    ex("Detect a key press", 'local UIS = game:GetService("UserInputService")\nUIS.InputBegan:Connect(function(input, processed)\n\tif processed then return end\n\tif input.KeyCode == Enum.KeyCode.E then\n\t\tprint("E pressed!")\n\tend\nend)'),
    ex("Check mouse position", 'local pos = UIS:GetMouseLocation()\nprint(pos.X, pos.Y)'),
  ],
  Sound: [
    ex("Play a sound", 'local sound = Instance.new("Sound")\nsound.SoundId = "rbxassetid://123456789"\nsound.Parent = workspace\nsound:Play()'),
    ex("Loop background music", 'sound.Looped = true\nsound.Volume = 0.5\nsound:Play()'),
  ],
  ParticleEmitter: [
    ex("Burst of particles", 'local emitter = part:FindFirstChildOfClass("ParticleEmitter")\nemitter:Emit(50)'),
  ],
  Fire: [
    ex("Set a part on fire", 'local fire = Instance.new("Fire")\nfire.Size = 8\nfire.Heat = 12\nfire.Parent = part'),
  ],
  Beam: [
    ex("Connect two attachments", 'local beam = Instance.new("Beam")\nbeam.Attachment0 = partA.Attachment\nbeam.Attachment1 = partB.Attachment\nbeam.Parent = partA'),
  ],
  ClickDetector: [
    ex("React to clicks", 'local cd = Instance.new("ClickDetector")\ncd.Parent = part\ncd.MouseClick:Connect(function(player)\n\tprint(player.Name .. " clicked!")\nend)'),
  ],
  ProximityPrompt: [
    ex("Interactive prompt", 'local prompt = Instance.new("ProximityPrompt")\nprompt.ActionText = "Open"\nprompt.Parent = part\nprompt.Triggered:Connect(function(player)\n\tprint(player.Name .. " triggered")\nend)'),
  ],
  Tool: [
    ex("Handle tool activation", 'local tool = script.Parent\ntool.Activated:Connect(function()\n\tprint("Tool used!")\nend)'),
  ],
  Camera: [
    ex("Move the camera", 'local camera = workspace.CurrentCamera\ncamera.CameraType = Enum.CameraType.Scriptable\ncamera.CFrame = CFrame.new(Vector3.new(0, 30, 30), Vector3.zero)'),
  ],
  Lighting: [
    ex("Set night time", 'local Lighting = game:GetService("Lighting")\nLighting.ClockTime = 0\nLighting.Brightness = 1'),
    ex("Day/night cycle", 'while true do\n\tLighting.ClockTime = (Lighting.ClockTime + 0.01) % 24\n\ttask.wait(0.1)\nend'),
  ],
  PointLight: [
    ex("Add a light to a part", 'local light = Instance.new("PointLight")\nlight.Range = 16\nlight.Brightness = 2\nlight.Parent = part'),
  ],
  SpawnLocation: [
    ex("Team spawn point", 'local spawn = Instance.new("SpawnLocation")\nspawn.Neutral = true\nspawn.Anchored = true\nspawn.Parent = workspace'),
  ],
  Seat: [
    ex("Detect who sat down", 'seat:GetPropertyChangedSignal("Occupant"):Connect(function()\n\tif seat.Occupant then\n\t\tprint("Occupied by:", seat.Occupant.Parent.Name)\n\tend\nend)'),
  ],
  ScreenGui: [
    ex("Create a GUI", 'local gui = Instance.new("ScreenGui")\ngui.Parent = player.PlayerGui'),
  ],
  Frame: [
    ex("Centered frame", 'local frame = Instance.new("Frame")\nframe.Size = UDim2.new(0, 200, 0, 100)\nframe.Position = UDim2.new(0.5, -100, 0.5, -50)\nframe.Parent = gui'),
  ],
  TextLabel: [
    ex("Show a message", 'local label = Instance.new("TextLabel")\nlabel.Text = "Hello, world!"\nlabel.Size = UDim2.new(0, 200, 0, 40)\nlabel.Parent = gui'),
  ],
  TextButton: [
    ex("Handle button clicks", 'local button = script.Parent\nbutton.MouseButton1Click:Connect(function()\n\tprint("Clicked!")\nend)'),
  ],
  Script: [
    ex("Reference the script", 'print("Running:", script:GetFullName())'),
  ],
  ModuleScript: [
    ex("Create and require a module", '-- ModuleScript\nlocal M = {}\nfunction M.greet(name)\n\treturn "Hello, " .. name\nend\nreturn M\n\n-- Script\nlocal M = require(script.Parent.ModuleScript)\nprint(M.greet("Studio"))'),
  ],
  StringValue: [
    ex("Store shared data", 'local sv = Instance.new("StringValue")\nsv.Name = "Stage"\nsv.Value = "Lobby"\nsv.Parent = game.ReplicatedStorage\nsv.Changed:Connect(print)'),
  ],
  IntValue: [
    ex("Simple counter", 'local counter = Instance.new("IntValue")\ncounter.Value = 0\ncounter.Parent = workspace\ncounter.Value += 1'),
  ],
  Attachment: [
    ex("Add an attachment", 'local att = Instance.new("Attachment")\natt.Position = Vector3.new(0, 1, 0)\natt.Parent = part'),
  ],
  WeldConstraint: [
    ex("Weld two parts", 'local weld = Instance.new("WeldConstraint")\nweld.Part0 = partA\nweld.Part1 = partB\nweld.Parent = partA'),
  ],
  HingeConstraint: [
    ex("Motorized hinge", 'local hinge = Instance.new("HingeConstraint")\nhinge.ActuatorType = Enum.ActuatorType.Motor\nhinge.AngularVelocity = 2\nhinge.MotorMaxTorque = 10000\nhinge.Attachment0 = partA.Attachment\nhinge.Attachment1 = partB.Attachment\nhinge.Parent = partA'),
  ],
  Vector3: [
    ex("Basic math", 'local a = Vector3.new(1, 2, 3)\nlocal b = Vector3.new(4, 5, 6)\nprint(a + b)\nprint(a:Dot(b))'),
    ex("Distance between points", 'local dist = (partA.Position - partB.Position).Magnitude\nprint("Distance:", dist)'),
  ],
  CFrame: [
    ex("Look at a target", 'part.CFrame = CFrame.new(part.Position, target.Position)'),
    ex("Rotate around an axis", 'part.CFrame = part.CFrame * CFrame.Angles(0, math.rad(45), 0)'),
  ],
  Color3: [
    ex("Create colors", 'local red = Color3.fromRGB(255, 0, 0)\nlocal sky = Color3.fromHSV(0.6, 0.7, 1)\npart.Color = red:Lerp(sky, 0.5)'),
  ],
  task: [
    ex("Delayed execution", 'task.delay(2, function()\n\tprint("2 seconds later")\nend)'),
    ex("Spawn a background task", 'task.spawn(function()\n\twhile true do\n\t\tprint("tick")\n\t\ttask.wait(1)\n\tend\nend)'),
  ],
  math: [
    ex("Random and clamp", 'local n = math.random(1, 10)\nlocal clamped = math.clamp(n * 2, 0, 15)\nprint(n, clamped)'),
  ],
  string: [
    ex("Format and match", 'local s = string.format("Score: %d", 42)\nprint(s)\nprint(string.match(s, "%d+"))'),
  ],
  table: [
    ex("Insert and sort", 'local t = { 3, 1, 2 }\ntable.insert(t, 4)\ntable.sort(t)\nprint(table.concat(t, ", "))'),
  ],
});

export function examplesFor(name) {
  const list = API_EXAMPLES[name];
  return Array.isArray(list) ? list : [];
}

export function totalExampleCount() {
  let n = 0;
  for (const key of Object.keys(API_EXAMPLES)) n += API_EXAMPLES[key].length;
  return n;
}
