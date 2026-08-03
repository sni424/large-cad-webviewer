#include <BRepMesh_IncrementalMesh.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Message_ProgressRange.hxx>
#include <RWGltf_CafWriter.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TColStd_IndexedDataMapOfStringString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TCollection_AsciiString.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopLoc_Location.hxx>
#include <Poly_Triangulation.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_ColorType.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

// CLI에서 받은 변환 옵션을 한 곳에 모아두는 구조체입니다.
// 사용 예:
//   --input cargo.step
//   --output cargo.glb
//   --linear-deflection 2.0
//   --angular-deflection 0.7
struct Options {
  std::string inputPath;
  std::string outputPath;
  std::string manifestPath;
  std::string urlPrefix = "/models/cargo-ship";
  bool analyzeOnly = false;
  bool splitComponents = false;

  // linearDeflection은 원본 CAD 곡면과 삼각형 mesh 사이의 허용 거리 오차입니다.
  // 값이 작을수록 더 정밀하지만 triangle 수와 GLB 용량이 커집니다.
  double linearDeflection = 0.5;

  // angularDeflection은 곡면의 방향 변화 허용 오차입니다.
  // 값이 작을수록 원통/곡면이 더 부드럽지만 mesh가 무거워집니다.
  double angularDeflection = 0.5;

  // true면 모델 크기에 맞춰 상대적인 deflection을 적용합니다.
  // 대형 CAD에서는 true가 보통 더 무난한 시작점입니다.
  bool relative = true;
};

// 사용자가 옵션을 잘못 입력했거나 --help를 입력했을 때 보여주는 안내입니다.
void printUsage() {
  std::cout
      << "Usage:\n"
      << "  occt-step-to-glb --input model.step --output model.glb "
      << "[--linear-deflection 0.5] [--angular-deflection 0.5] [--relative true]\n"
      << "  occt-step-to-glb --analyze --input model.step\n"
      << "  occt-step-to-glb --split-components --input model.step --output public/models/cargo-ship "
      << "--manifest public/manifests/cargo-ship.manifest.json [--url-prefix /models/cargo-ship]\n";
}

// 문자열 옵션으로 들어온 true/false 값을 C++ bool로 바꿉니다.
bool parseBool(const std::string& value) {
  if (value == "true" || value == "1" || value == "yes") {
    return true;
  }
  if (value == "false" || value == "0" || value == "no") {
    return false;
  }
  throw std::runtime_error("Invalid boolean value: " + value);
}

// main(argc, argv)로 들어온 CLI 인자를 Options 구조체로 바꿉니다.
// 변환 로직 자체와 명령줄 파싱을 분리해두면 나중에 서버 job에서도 재사용하기 쉽습니다.
Options parseArgs(int argc, char** argv) {
  Options options;

  for (int index = 1; index < argc; ++index) {
    const std::string key = argv[index];

    auto requireValue = [&](const std::string& optionName) -> std::string {
      if (index + 1 >= argc) {
        throw std::runtime_error("Missing value for " + optionName);
      }
      return argv[++index];
    };

    if (key == "--input") {
      options.inputPath = requireValue(key);
    } else if (key == "--output") {
      options.outputPath = requireValue(key);
    } else if (key == "--manifest") {
      options.manifestPath = requireValue(key);
    } else if (key == "--url-prefix") {
      options.urlPrefix = requireValue(key);
    } else if (key == "--analyze") {
      options.analyzeOnly = true;
    } else if (key == "--split-components") {
      options.splitComponents = true;
    } else if (key == "--linear-deflection") {
      options.linearDeflection = std::stod(requireValue(key));
    } else if (key == "--angular-deflection") {
      options.angularDeflection = std::stod(requireValue(key));
    } else if (key == "--relative") {
      options.relative = parseBool(requireValue(key));
    } else if (key == "--help" || key == "-h") {
      printUsage();
      std::exit(0);
    } else {
      throw std::runtime_error("Unknown option: " + key);
    }
  }

  if (options.inputPath.empty()) {
    throw std::runtime_error("--input is required");
  }

  if (!options.analyzeOnly && options.outputPath.empty()) {
    throw std::runtime_error("--output is required unless --analyze is used");
  }

  if (options.splitComponents && options.manifestPath.empty()) {
    throw std::runtime_error("--manifest is required when --split-components is used");
  }

  if (options.linearDeflection <= 0.0 || options.angularDeflection <= 0.0) {
    throw std::runtime_error("Deflection values must be greater than zero");
  }

  return options;
}

struct ShapeStats {
  int labels = 0;
  int shapes = 0;
  int components = 0;
  int faces = 0;
  long long triangles = 0;
};

struct ExportedTile {
  std::string id;
  std::string fileName;
  std::uintmax_t estimatedBytes = 0;
  double minX = 0.0;
  double minY = 0.0;
  double minZ = 0.0;
  double maxX = 0.0;
  double maxY = 0.0;
  double maxZ = 0.0;
  double centerX = 0.0;
  double centerY = 0.0;
  double centerZ = 0.0;
  double radius = 0.0;
  int faces = 0;
  long long triangles = 0;
};

struct Normalization {
  double offsetX = 0.0;
  double offsetY = 0.0;
  double offsetZ = 0.0;
  double scale = 0.001;
};

long long countShapeTriangles(const TopoDS_Shape& shape, int& faceCount) {
  long long triangles = 0;
  faceCount = 0;

  for (TopExp_Explorer explorer(shape, TopAbs_FACE); explorer.More(); explorer.Next()) {
    ++faceCount;

    const TopoDS_Face face = TopoDS::Face(explorer.Current());
    TopLoc_Location location;
    const Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);

    if (!triangulation.IsNull()) {
      triangles += triangulation->NbTriangles();
    }
  }

  return triangles;
}

void printShapeBox(const TopoDS_Shape& shape, const std::string& indent) {
  Bnd_Box box;
  BRepBndLib::Add(shape, box);

  if (box.IsVoid()) {
    std::cout << indent << "bbox: empty\n";
    return;
  }

  Standard_Real minX = 0.0;
  Standard_Real minY = 0.0;
  Standard_Real minZ = 0.0;
  Standard_Real maxX = 0.0;
  Standard_Real maxY = 0.0;
  Standard_Real maxZ = 0.0;
  box.Get(minX, minY, minZ, maxX, maxY, maxZ);

  std::cout << indent << "bbox: min(" << minX << ", " << minY << ", " << minZ
            << "), max(" << maxX << ", " << maxY << ", " << maxZ << ")\n";
}

ExportedTile buildTileInfo(
    const std::string& id,
    const std::string& fileName,
    const TopoDS_Shape& shape
) {
  ExportedTile tile;
  tile.id = id;
  tile.fileName = fileName;

  Bnd_Box box;
  BRepBndLib::Add(shape, box);

  if (!box.IsVoid()) {
    box.Get(tile.minX, tile.minY, tile.minZ, tile.maxX, tile.maxY, tile.maxZ);
    tile.centerX = (tile.minX + tile.maxX) * 0.5;
    tile.centerY = (tile.minY + tile.maxY) * 0.5;
    tile.centerZ = (tile.minZ + tile.maxZ) * 0.5;

    const double sizeX = tile.maxX - tile.minX;
    const double sizeY = tile.maxY - tile.minY;
    const double sizeZ = tile.maxZ - tile.minZ;
    tile.radius = std::sqrt(sizeX * sizeX + sizeY * sizeY + sizeZ * sizeZ) * 0.5;
  }

  tile.triangles = countShapeTriangles(shape, tile.faces);

  return tile;
}

TopoDS_Shape normalizeShape(const TopoDS_Shape& shape, const Normalization& normalization) {
  gp_Trsf translation;
  translation.SetTranslation(gp_Vec(
      -normalization.offsetX,
      -normalization.offsetY,
      -normalization.offsetZ
  ));

  BRepBuilderAPI_Transform translated(shape, translation, true);

  gp_Trsf scale;
  scale.SetScale(gp_Pnt(0.0, 0.0, 0.0), normalization.scale);

  BRepBuilderAPI_Transform scaled(translated.Shape(), scale, true);
  return scaled.Shape();
}

Normalization computeNormalization(
    const Handle(XCAFDoc_ShapeTool)& shapeTool,
    const TDF_LabelSequence& freeShapes
) {
  Bnd_Box globalBox;

  for (Standard_Integer index = 1; index <= freeShapes.Length(); ++index) {
    const TopoDS_Shape shape = shapeTool->GetShape(freeShapes.Value(index));
    if (!shape.IsNull()) {
      BRepBndLib::Add(shape, globalBox);
    }
  }

  if (globalBox.IsVoid()) {
    return {};
  }

  double minX = 0.0;
  double minY = 0.0;
  double minZ = 0.0;
  double maxX = 0.0;
  double maxY = 0.0;
  double maxZ = 0.0;
  globalBox.Get(minX, minY, minZ, maxX, maxY, maxZ);

  Normalization normalization;
  normalization.offsetX = (minX + maxX) * 0.5;
  normalization.offsetY = minY;
  normalization.offsetZ = (minZ + maxZ) * 0.5;

  return normalization;
}

std::string jsonPath(const std::string& path) {
  std::string normalized = path;
  for (char& ch : normalized) {
    if (ch == '\\') {
      ch = '/';
    }
  }
  return normalized;
}

void writeManifest(
    const fs::path& manifestPath,
    const std::string& urlPrefix,
    const std::vector<ExportedTile>& tiles
) {
  if (!manifestPath.parent_path().empty()) {
    fs::create_directories(manifestPath.parent_path());
  }

  std::ofstream out(manifestPath);
  if (!out) {
    throw std::runtime_error("Failed to open manifest for writing: " + manifestPath.string());
  }

  out << std::fixed << std::setprecision(3);
  out << "{\n";
  out << "  \"id\": \"cargo-ship-components\",\n";
  out << "  \"name\": \"Cargo Ship Component Tiles\",\n";
  out << "  \"units\": \"m\",\n";
  out << "  \"description\": \"Component-level normalized GLB tiles generated from STEP by OCCT.\",\n";
  out << "  \"tiles\": [\n";

  for (size_t index = 0; index < tiles.size(); ++index) {
    const ExportedTile& tile = tiles[index];
    const std::string url = jsonPath(urlPrefix + "/" + tile.fileName);

    out << "    {\n";
    out << "      \"id\": \"" << tile.id << "\",\n";
    out << "      \"center\": [" << tile.centerX << ", " << tile.centerY << ", " << tile.centerZ << "],\n";
    out << "      \"radius\": " << tile.radius << ",\n";
    out << "      \"bounds\": {\n";
    out << "        \"min\": [" << tile.minX << ", " << tile.minY << ", " << tile.minZ << "],\n";
    out << "        \"max\": [" << tile.maxX << ", " << tile.maxY << ", " << tile.maxZ << "]\n";
    out << "      },\n";
    out << "      \"lods\": {\n";
    out << "        \"high\": { \"url\": \"" << url << "\", \"estimatedBytes\": " << tile.estimatedBytes << " },\n";
    out << "        \"medium\": { \"url\": \"" << url << "\", \"estimatedBytes\": " << tile.estimatedBytes << " },\n";
    out << "        \"proxy\": { \"url\": \"proxy-box://" << tile.id << "\", \"estimatedBytes\": 2048 }\n";
    out << "      },\n";
    out << "      \"metadataUrl\": \"/metadata/" << tile.id << ".json\"\n";
    out << "    }" << (index + 1 == tiles.size() ? "\n" : ",\n");
  }

  out << "  ]\n";
  out << "}\n";
}

// reference(instance) label에는 색상이 직접 붙지 않고, GetReferredShape로 찾는
// prototype label 쪽에 색상이 붙어 있는 경우가 XCAF 조립 구조에서는 일반적입니다.
// 색상을 조회할 땐 항상 이 함수로 얻은 label을 사용해야 합니다.
// (XCAFPrs::CollectStyleSettings로 대체를 시도했으나 실기기 검증에서 색이 거의 전부
// 사라지는 회귀가 확인되어, 직접 검증됐던 이 방식으로 되돌립니다.)
TDF_Label resolveColorLabel(const Handle(XCAFDoc_ShapeTool)& shapeTool, const TDF_Label& label) {
  TDF_Label referredLabel;
  if (XCAFDoc_ShapeTool::IsReference(label) && XCAFDoc_ShapeTool::GetReferredShape(label, referredLabel)) {
    return referredLabel;
  }
  return label;
}

const XCAFDoc_ColorType kColorTypes[] = {
    XCAFDoc_ColorGen,
    XCAFDoc_ColorSurf,
    XCAFDoc_ColorCurv,
};

// label 하나에서 찾을 수 있는 색을 모두 tileColorTool에 복사합니다.
// 하나라도 찾았으면 true를 돌려줍니다.
bool copyLabelColor(
    const TDF_Label& fromLabel,
    const Handle(XCAFDoc_ColorTool)& tileColorTool,
    const TDF_Label& toLabel
) {
  bool found = false;

  for (const XCAFDoc_ColorType colorType : kColorTypes) {
    Quantity_Color color;
    if (XCAFDoc_ColorTool::GetColor(fromLabel, colorType, color)) {
      tileColorTool->SetColor(toLabel, color, colorType);
      found = true;
    }
  }

  return found;
}

bool copyMatchingSubShapeColor(
    const TDF_LabelSequence& sourceSubShapeLabels,
    const TopoDS_Shape& sourceFace,
    const Handle(XCAFDoc_ColorTool)& tileColorTool,
    const TDF_Label& targetFaceLabel
) {
  bool found = false;

  for (Standard_Integer index = 1; index <= sourceSubShapeLabels.Length(); ++index) {
    const TDF_Label sourceSubShapeLabel = sourceSubShapeLabels.Value(index);
    const TopoDS_Shape sourceSubShape = XCAFDoc_ShapeTool::GetShape(sourceSubShapeLabel);

    if (sourceSubShape.IsNull() || !(sourceSubShape.IsSame(sourceFace) || sourceSubShape.IsPartner(sourceFace))) {
      continue;
    }

    found = copyLabelColor(sourceSubShapeLabel, tileColorTool, targetFaceLabel) || found;
  }

  return found;
}

void exportDocumentLabelGlb(
    const Handle(TDocStd_Document)& sourceDocument,
    const TDF_Label& sourceLabel,
    const TopoDS_Shape& sourceShape,
    const fs::path& outputPath,
    const Options& options
) {
  if (!outputPath.parent_path().empty()) {
    fs::create_directories(outputPath.parent_path());
  }

  // 색상/face style은 원본 XCAF document의 label 관계 안에 들어 있습니다.
  // 새 문서에 shape만 다시 넣으면 그 관계가 끊겨 split GLB가 회색이 되므로,
  // component label을 원본 문서에서 root로 직접 export합니다.
  BRepMesh_IncrementalMesh mesher(
      sourceShape,
      options.linearDeflection,
      options.relative,
      options.angularDeflection,
      true
  );
  mesher.Perform();

  NCollection_Sequence<TDF_Label> rootLabels;
  rootLabels.Append(sourceLabel);

  TColStd_IndexedDataMapOfStringString fileInfo;
  fileInfo.Add("Generator", "large-cad-webviewer occt-step-to-glb split-components-original-xcaf");

  RWGltf_CafWriter writer(TCollection_AsciiString(outputPath.string().c_str()), true);
  if (!writer.Perform(sourceDocument, rootLabels, nullptr, fileInfo, Message_ProgressRange())) {
    throw std::runtime_error("OCCT failed to write component GLB: " + outputPath.string());
  }
}
void exportShapeGlb(
    const Handle(XCAFDoc_ShapeTool)& sourceShapeTool,
    const Handle(XCAFDoc_ColorTool)& sourceColorTool,
    const TopoDS_Shape& sourceShape,
    const TopoDS_Shape& shape,
    const TDF_Label& sourceLabel,
    const TDF_Label& parentLabel,
    const fs::path& outputPath,
    const Options& options
) {
  if (!outputPath.parent_path().empty()) {
    fs::create_directories(outputPath.parent_path());
  }

  BRepMesh_IncrementalMesh mesher(
      shape,
      options.linearDeflection,
      options.relative,
      options.angularDeflection,
      true
  );
  mesher.Perform();

  Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
  Handle(TDocStd_Document) tileDocument;
  app->NewDocument("MDTV-XCAF", tileDocument);

  Handle(XCAFDoc_ShapeTool) tileShapeTool = XCAFDoc_DocumentTool::ShapeTool(tileDocument->Main());
  Handle(XCAFDoc_ColorTool) tileColorTool = XCAFDoc_DocumentTool::ColorTool(tileDocument->Main());
  const TDF_Label tileLabel = tileShapeTool->AddShape(shape, false);

  // sourceLabel은 조립 트리의 component(reference) label이라 색상이 직접 붙어있지 않습니다.
  // 실제 색상(라벨/면 색 모두)은 GetReferredShape로 찾는 prototype label 쪽에 붙습니다.
  // prototype과 sourceShape/shape는 위치(Location)만 다를 뿐 같은 topology이므로
  // TopExp_Explorer 순회 순서가 그대로 대응됩니다.
  const TDF_Label colorLabel = resolveColorLabel(sourceShapeTool, sourceLabel);
  const TopoDS_Shape colorShape =
      colorLabel == sourceLabel ? sourceShape : sourceShapeTool->GetShape(colorLabel);

  bool hasOwnColor = copyLabelColor(colorLabel, tileColorTool, tileLabel);

  // 이 shape 자체에 색이 없으면 상위 assembly의 색을 기본값으로 상속해봅니다.
  if (!hasOwnColor && !parentLabel.IsNull()) {
    const TDF_Label parentColorLabel = resolveColorLabel(sourceShapeTool, parentLabel);
    hasOwnColor = copyLabelColor(parentColorLabel, tileColorTool, tileLabel);
  }

  // 그래도 못 찾았으면(자기 label/prototype/상위 assembly 어디에도 색이 없는 shape),
  // material 필드를 비워두는 대신 단일 GLB에서 무색 shape에 실제로 쓰이는
  // 기본색을 명시적으로 채워둡니다. 비워두면 glTF 로더가 자체 기본 머티리얼로
  // 대체하면서 doubleSided 등이 달라져 렌더링이 어긋날 수 있습니다.
  if (!hasOwnColor) {
    tileColorTool->SetColor(tileLabel, Quantity_Color(0.2423, 0.2623, 0.2623, Quantity_TOC_RGB), XCAFDoc_ColorSurf);
  }

  TopExp_Explorer sourceFaceExplorer(colorShape, TopAbs_FACE);
  TopExp_Explorer targetFaceExplorer(shape, TopAbs_FACE);
  TDF_LabelSequence sourceSubShapeLabels;
  XCAFDoc_ShapeTool::GetSubShapes(colorLabel, sourceSubShapeLabels);

  for (; sourceFaceExplorer.More() && targetFaceExplorer.More();
       sourceFaceExplorer.Next(), targetFaceExplorer.Next()) {
    const TopoDS_Shape sourceFace = sourceFaceExplorer.Current();
    const TopoDS_Shape targetFace = targetFaceExplorer.Current();
    TDF_Label targetFaceLabel;
    TDF_Label sourceFaceLabel;
    bool copiedSubShapeColor = false;

    // XCAF에서 face별 색상은 TopoDS_Face 자체가 아니라 shape label 아래의
    // subshape label에 붙어 있는 경우가 많습니다. 먼저 OCCT 내부 맵으로
    // 현재 sourceFace에 대응하는 subshape label을 찾고, 그 label의 색을
    // 새 tile 문서의 targetFace label에 복사합니다.
    if (sourceShapeTool->FindSubShape(colorLabel, sourceFace, sourceFaceLabel) && !sourceFaceLabel.IsNull()) {
      tileShapeTool->AddSubShape(tileLabel, targetFace, targetFaceLabel);

      if (!targetFaceLabel.IsNull()) {
        copiedSubShapeColor = copyLabelColor(sourceFaceLabel, tileColorTool, targetFaceLabel);
      }
    }

    // FindSubShape가 놓치는 reference/prototype 조합을 대비한 보조 경로입니다.
    if (!copiedSubShapeColor && !sourceSubShapeLabels.IsEmpty()) {
      if (targetFaceLabel.IsNull()) {
        tileShapeTool->AddSubShape(tileLabel, targetFace, targetFaceLabel);
      }

      if (!targetFaceLabel.IsNull()) {
        copiedSubShapeColor = copyMatchingSubShapeColor(
            sourceSubShapeLabels,
            sourceFace,
            tileColorTool,
            targetFaceLabel
        );
      }
    }

    if (copiedSubShapeColor) {
      continue;
    }

    for (const XCAFDoc_ColorType colorType : kColorTypes) {
      Quantity_Color color;
      bool hasFaceColor = false;

      if (sourceColorTool->GetColor(sourceFace, colorType, color)) {
        hasFaceColor = true;
      }

      if (!hasFaceColor) {
        continue;
      }

      if (targetFaceLabel.IsNull()) {
        tileShapeTool->AddSubShape(tileLabel, targetFace, targetFaceLabel);
      }

      if (!targetFaceLabel.IsNull()) {
        tileColorTool->SetColor(targetFaceLabel, color, colorType);
      }
    }
  }

  TColStd_IndexedDataMapOfStringString fileInfo;
  fileInfo.Add("Generator", "large-cad-webviewer occt-step-to-glb split-components");

  RWGltf_CafWriter writer(TCollection_AsciiString(outputPath.string().c_str()), true);
  if (!writer.Perform(tileDocument, fileInfo, Message_ProgressRange())) {
    throw std::runtime_error("OCCT failed to write component GLB: " + outputPath.string());
  }
}

void collectComponentLabels(
    const Handle(XCAFDoc_ShapeTool)& shapeTool,
    const TDF_LabelSequence& freeShapes,
    TDF_LabelSequence& componentLabels,
    TDF_LabelSequence& parentLabels
) {
  for (Standard_Integer index = 1; index <= freeShapes.Length(); ++index) {
    TDF_LabelSequence children;
    shapeTool->GetComponents(freeShapes.Value(index), children);

    if (children.IsEmpty()) {
      componentLabels.Append(freeShapes.Value(index));
      parentLabels.Append(TDF_Label());
      continue;
    }

    for (Standard_Integer childIndex = 1; childIndex <= children.Length(); ++childIndex) {
      componentLabels.Append(children.Value(childIndex));
      parentLabels.Append(freeShapes.Value(index));
    }
  }
}

void splitComponentsToGlb(
    const Handle(TDocStd_Document)& document,
    const Handle(XCAFDoc_ShapeTool)& shapeTool,
    const TDF_LabelSequence& freeShapes,
    const Options& options
) {
  // shapeTool->Label()은 XCAF 문서 안의 shapes section label입니다.
  // ColorTool은 document main label 아래에 있으므로 Root()가 아니라 Father()를 써야
  // 원본 STEP 문서의 color table과 shape-color 링크를 정상 조회할 수 있습니다.
  const TDF_Label documentMainLabel = shapeTool->Label().Father();
  Handle(XCAFDoc_ColorTool) sourceColorTool =
      XCAFDoc_DocumentTool::ColorTool(documentMainLabel);
  TDF_LabelSequence componentLabels;
  TDF_LabelSequence parentLabels;
  collectComponentLabels(shapeTool, freeShapes, componentLabels, parentLabels);
  const Normalization normalization = computeNormalization(shapeTool, freeShapes);

  std::cout << "[3/4] Exporting " << componentLabels.Length() << " component GLB tile(s)\n";
  std::cout << "  normalization: offset=(" << normalization.offsetX << ", "
            << normalization.offsetY << ", " << normalization.offsetZ
            << "), scale=" << normalization.scale << "\n";

  std::vector<ExportedTile> exportedTiles;
  exportedTiles.reserve(static_cast<size_t>(componentLabels.Length()));

  for (Standard_Integer index = 1; index <= componentLabels.Length(); ++index) {
    const TDF_Label label = componentLabels.Value(index);
    const TopoDS_Shape sourceShape = shapeTool->GetShape(label);

    if (sourceShape.IsNull()) {
      continue;
    }

    const TopoDS_Shape shape = normalizeShape(sourceShape, normalization);

    const std::string id = "component-" + (index < 10 ? std::string("00") : index < 100 ? std::string("0") : std::string("")) + std::to_string(index);
    const std::string fileName = id + ".glb";
    const fs::path tilePath = fs::path(options.outputPath) / fileName;

    std::cout << "  exporting " << id << " -> " << tilePath.string() << "\n";
    exportDocumentLabelGlb(document, label, sourceShape, tilePath, options);

    ExportedTile tile = buildTileInfo(id, fileName, shape);
    tile.estimatedBytes = fs::file_size(tilePath);
    exportedTiles.push_back(tile);
  }

  std::cout << "[4/4] Writing manifest: " << options.manifestPath << "\n";
  writeManifest(fs::path(options.manifestPath), options.urlPrefix, exportedTiles);
}

void analyzeLabelShapes(
    const Handle(XCAFDoc_ShapeTool)& shapeTool,
    const TDF_LabelSequence& labels,
    const Options& options,
    ShapeStats& stats,
    int depth = 0
) {
  const std::string indent(static_cast<size_t>(depth) * 2, ' ');

  for (Standard_Integer index = 1; index <= labels.Length(); ++index) {
    ++stats.labels;

    const TDF_Label label = labels.Value(index);
    const TopoDS_Shape shape = shapeTool->GetShape(label);

    std::cout << indent << "- label #" << stats.labels;

    if (shape.IsNull()) {
      std::cout << " shape=null\n";
    } else {
      ++stats.shapes;

      BRepMesh_IncrementalMesh mesher(
          shape,
          options.linearDeflection,
          options.relative,
          options.angularDeflection,
          true
      );
      mesher.Perform();

      int shapeFaces = 0;
      const long long shapeTriangles = countShapeTriangles(shape, shapeFaces);
      stats.faces += shapeFaces;
      stats.triangles += shapeTriangles;

      std::cout << " faces=" << shapeFaces << " triangles=" << shapeTriangles << "\n";
      printShapeBox(shape, indent + "  ");
    }

    TDF_LabelSequence childLabels;
    shapeTool->GetComponents(label, childLabels);
    if (!childLabels.IsEmpty()) {
      stats.components += childLabels.Length();
      std::cout << indent << "  components=" << childLabels.Length() << "\n";
      analyzeLabelShapes(shapeTool, childLabels, options, stats, depth + 1);
    }
  }
}

// 이 함수가 이 프로그램에서 가장 중요한 부분입니다.
// XCAF 문서 안의 shape들을 돌면서 BRep/NURBS 기반 CAD 형상을 삼각형 mesh로 바꿉니다.
void meshLabelShapes(
    const Handle(XCAFDoc_ShapeTool)& shapeTool,
    const TDF_LabelSequence& labels,
    const Options& options
) {
  // XCAF에서는 shape가 TDF_Label이라는 노드에 매달려 있습니다.
  // label은 "이 CAD 부품/assembly 노드가 어디에 있는지"를 가리키는 핸들처럼 보면 됩니다.
  for (Standard_Integer index = 1; index <= labels.Length(); ++index) {
    const TDF_Label label = labels.Value(index);

    // label에서 실제 CAD 형상인 TopoDS_Shape를 꺼냅니다.
    // TopoDS_Shape 안에는 아직 GPU가 바로 그릴 triangle이 아니라 BRep 형상이 들어 있습니다.
    const TopoDS_Shape shape = shapeTool->GetShape(label);

    if (!shape.IsNull()) {
      // 여기서 진짜 테셀레이션이 일어납니다.
      //
      // BRepMesh_IncrementalMesh는 CAD의 정확한 BRep/NURBS/곡면 형상을
      // WebGL/Three.js가 그릴 수 있는 triangle mesh로 근사합니다.
      //
      // 이 작업이 끝나면 shape 내부 face들에 triangulation 데이터가 붙고,
      // 뒤의 RWGltf_CafWriter가 그 triangle 데이터를 GLB로 저장할 수 있습니다.
      BRepMesh_IncrementalMesh mesher(
          shape,
          options.linearDeflection,
          options.relative,
          options.angularDeflection,
          true
      );

      // 생성자만으로도 meshing이 수행되는 경우가 있지만,
      // 명시적으로 Perform을 호출해서 "지금 mesh를 만들어라"라고 확실히 실행합니다.
      mesher.Perform();
    }

    // STEP 파일은 하나의 shape만 있는 것이 아니라 assembly 구조를 가질 수 있습니다.
    // 예: ship -> deck -> pipe group -> pipe part
    //
    // 현재 label 아래에 component가 있으면, 그 자식들도 같은 방식으로 재귀 테셀레이션합니다.
    TDF_LabelSequence childLabels;
    shapeTool->GetComponents(label, childLabels);
    if (!childLabels.IsEmpty()) {
      meshLabelShapes(shapeTool, childLabels, options);
    }
  }
}

// STEP 파일 하나를 GLB 파일 하나로 변환하는 전체 파이프라인입니다.
//
// 큰 흐름:
//   1. 입력/출력 경로 확인
//   2. STEP 읽기
//   3. STEP 데이터를 XCAF 문서로 옮기기
//   4. XCAF 안의 shape들을 테셀레이션하기
//   5. GLB로 저장하기
void convertStepToGlb(const Options& options) {
  const fs::path inputPath(options.inputPath);
  const fs::path outputPath(options.outputPath);

  // 입력 STEP 파일이 실제로 존재하는지 먼저 확인합니다.
  if (!fs::exists(inputPath)) {
    throw std::runtime_error("Input file does not exist: " + inputPath.string());
  }

  // 이 변환기는 binary glTF인 .glb만 출력하도록 제한했습니다.
  // .gltf + .bin 분리 출력은 나중에 필요하면 별도 옵션으로 추가할 수 있습니다.
  if (!options.analyzeOnly && !options.splitComponents && outputPath.extension() != ".glb") {
    throw std::runtime_error("Output path must use .glb extension");
  }

  // public/models 같은 출력 폴더가 없으면 자동으로 만듭니다.
  if (!options.analyzeOnly && !options.splitComponents && !outputPath.parent_path().empty()) {
    fs::create_directories(outputPath.parent_path());
  }

  // XCAF 문서는 STEP의 assembly, 이름, 색상 같은 CAD 메타데이터를 담기 좋습니다.
  // 단순 Shape만 읽는 방식보다 나중에 part id, color, layer, metadata를 보존하기에 유리합니다.
  Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
  Handle(TDocStd_Document) document;
  app->NewDocument("MDTV-XCAF", document);

  // STEPCAFControl_Reader는 STEP 파일을 XCAF 문서로 읽는 OCCT reader입니다.
  // 이름, 색상, 레이어, 속성을 최대한 가져오도록 옵션을 켭니다.
  STEPCAFControl_Reader reader;
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(true);
  reader.SetPropsMode(true);

  std::cout << "[1/4] Reading STEP: " << inputPath.string() << "\n";

  // STEP 파일을 디스크에서 읽습니다.
  // 아직 document로 옮긴 것은 아니고, reader 내부에 STEP 데이터가 준비된 단계입니다.
  const IFSelect_ReturnStatus status = reader.ReadFile(inputPath.string().c_str());
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("OCCT failed to read STEP file");
  }

  std::cout << "[2/4] Transferring STEP to XCAF document\n";

  // reader가 읽은 STEP 데이터를 XCAF document로 옮깁니다.
  // 이 단계 이후 shapeTool로 assembly/shape 구조를 탐색할 수 있습니다.
  if (!reader.Transfer(document)) {
    throw std::runtime_error("OCCT failed to transfer STEP into XCAF document");
  }

  // XCAF 문서에서 shape 구조를 다루기 위한 도구를 얻습니다.
  Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(document->Main());

  // free shape는 XCAF 문서의 최상위 shape입니다.
  // 조선 CAD라면 최상위 ship assembly 하나일 수도 있고, 여러 block일 수도 있습니다.
  TDF_LabelSequence freeShapes;
  shapeTool->GetFreeShapes(freeShapes);

  if (options.splitComponents) {
    splitComponentsToGlb(document, shapeTool, freeShapes, options);
    return;
  }

  if (options.analyzeOnly) {
    ShapeStats stats;

    std::cout << "[3/4] Analyzing " << freeShapes.Length()
              << " free shape(s), linearDeflection=" << options.linearDeflection
              << ", angularDeflection=" << options.angularDeflection
              << ", relative=" << (options.relative ? "true" : "false") << "\n";
    analyzeLabelShapes(shapeTool, freeShapes, options, stats);

    std::cout << "[4/4] Analysis summary\n";
    std::cout << "labels: " << stats.labels << "\n";
    std::cout << "shapes: " << stats.shapes << "\n";
    std::cout << "components: " << stats.components << "\n";
    std::cout << "faces: " << stats.faces << "\n";
    std::cout << "triangles: " << stats.triangles << "\n";
    return;
  }

  std::cout << "[3/4] Tessellating " << freeShapes.Length()
            << " free shape(s), linearDeflection=" << options.linearDeflection
            << ", angularDeflection=" << options.angularDeflection
            << ", relative=" << (options.relative ? "true" : "false") << "\n";

  // 여기서 모든 최상위 shape와 자식 component들을 테셀레이션합니다.
  meshLabelShapes(shapeTool, freeShapes, options);

  std::cout << "[4/4] Writing GLB: " << outputPath.string() << "\n";

  // GLB 파일 안에 남길 간단한 generator 정보입니다.
  TColStd_IndexedDataMapOfStringString fileInfo;
  fileInfo.Add("Generator", "large-cad-webviewer occt-step-to-glb");

  // 두 번째 인자 true는 binary glTF, 즉 .glb 출력을 의미합니다.
  // writer는 위에서 만들어진 triangulation 데이터를 읽어서 GLB mesh로 저장합니다.
  RWGltf_CafWriter writer(TCollection_AsciiString(outputPath.string().c_str()), true);
  if (!writer.Perform(document, fileInfo, Message_ProgressRange())) {
    throw std::runtime_error("OCCT failed to write GLB file");
  }

  std::cout << "Done: " << outputPath.string() << "\n";
}

// 프로그램 시작점입니다.
// 1. 명령줄 옵션을 읽고
// 2. STEP -> GLB 변환을 실행하고
// 3. 오류가 있으면 사용자에게 메시지를 보여줍니다.
int main(int argc, char** argv) {
  try {
    const Options options = parseArgs(argc, argv);
    convertStepToGlb(options);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "Error: " << error.what() << "\n\n";
    printUsage();
    return 1;
  }
}
