# CATIA V5 Python Automation Workbook (win32com / COM API)

Reference for a code-generating model that writes Python scripts to drive **CATIA V5**
(R2x / V5-6R20xx) through its COM automation interface with `pywin32`.
Covers **Part Design**, **Generative Shape Design (GSD)** and **Assembly Design**.
Not valid for 3DEXPERIENCE, which has a different object model.

**Legend:** `⚠ verify` marks a signature or enum value that varies between releases or is
less certain. Before relying on it, confirm it with the macro recorder (section 4) or with
`V5Automation.chm`, found in `<CATIA install>\win_b64\code\bin\`.

**How to feed this to a model:** always include sections 1–5 (rules, object map, setup,
translation, helpers). Add only the workbench sections the task needs (8–14), plus one
worked example from section 15.

---

## 1. Golden rules (follow every time)

1. **Never invent a method or property name.** If something is not in this workbook, say so and
   ask for a recorded macro of the operation instead of guessing.
2. **Collections are 1-based.** Use `.Item(1)` … `.Item(coll.Count)` or `.Item("Name")`.
   Never `coll[0]`.
3. **Enum names do not exist in Python** with late binding. Use the integer constants from
   section 5 (named exactly like CATIA's enums, e.g. `catCstTypeOn = 2`).
4. **Most inputs are `Reference` objects**: `part.CreateReferenceFromObject(obj)`.
   Exceptions (pass the object itself):
   - sketch-based solids take the **Sketch** (`AddNewPad(sketch, 20)`), and their `...FromRef`
     variants take a Reference;
   - patterns take the **feature** to copy;
   - booleans take a **Body**;
   - GSD directions take a **HybridShapeDirection**.
5. **Part Design features** are inserted automatically after `part.InWorkObject`. **GSD features
   are not**: every `HybridShapeFactory` result must be added with
   `geo_set.AppendHybridShape(shape)`.
6. **Sketch geometry** can only be created between `f2d = sketch.OpenEdition()` and
   `sketch.CloseEdition()`. Add sketch constraints before `CloseEdition()`.
7. **Update after creating features**: `part.UpdateObject(feature)` (or `part.Update()`) inside
   `try/except pywintypes.com_error`. Update each GSD element before using it as an input.
8. **Units:** lengths in **mm**, angles in **degrees**. The exception is `Factory2D` arc
   start/end parameters, which are in **radians**.
9. **Methods that return data through an output array** (`GetCoordinates`, `GetCOG`,
   `GetComponents`, …) cannot be called directly from Python. Use `get_array()` from section 5.
10. **Methods need parentheses, properties do not:** `part.Update()` but `sel.Count`.
    Values live in `.Value`: `pad.FirstLimit.Dimension.Value = 30`.
11. Use Python `True`/`False` for booleans and tuples for arrays.
    VBA `Nothing` → `None` (or `NOTHING` from section 5 if `None` gives a type mismatch).
12. Write Windows paths as raw strings: `r"C:\work\part.CATPart"`. Create folders before
    `SaveAs`.

---

## 2. Object map

```
catia (Application)
 ├─ Documents ──► PartDocument
 │                 ├─ Part
 │                 │   ├─ MainBody / Bodies ─► Body ─► Sketches, Shapes, HybridBodies
 │                 │   ├─ HybridBodies (Geometrical Sets) ─► HybridBody ─► HybridShapes, HybridSketches, HybridBodies
 │                 │   ├─ OriginElements ─► PlaneXY, PlaneYZ, PlaneZX
 │                 │   ├─ ShapeFactory        (Part Design solids)
 │                 │   ├─ HybridShapeFactory  (GSD wireframe + surfaces)
 │                 │   ├─ Parameters, Relations
 │                 │   └─ InWorkObject        (insertion point)
 │                 ├─ Product (the part seen as a product: Publications, PartNumber)
 │                 ├─ Selection
 │                 └─ GetWorkbench("SPAWorkbench") ─► GetMeasurable(ref)
 │
 │               ProductDocument
 │                 └─ Product (root)
 │                     ├─ Products ─► Product (instance) ─► ReferenceProduct ─► .Parent = its Document
 │                     ├─ Connections("CATIAConstraints")  (assembly constraints)
 │                     ├─ Position / Move                   (placement)
 │                     └─ Publications, UserRefProperties, Analyze
 ├─ ActiveDocument, ActiveWindow.ActiveViewer
 └─ SystemService.Evaluate (run VBScript inside CATIA)
```

Sketch internals: `Sketch.OpenEdition()` → `Factory2D` (CreateLine, CreateClosedCircle, …);
`Sketch.Constraints`; `Sketch.AbsoluteAxis`.

---

## 3. Setup and connection

- Windows only, with CATIA V5 installed. `pip install pywin32`.
- Run Python at the **same privilege level** as CATIA: both elevated (admin) or both normal.
- If `Dispatch` fails with "Invalid class string", register CATIA once by running
  `CNEXT.exe /regserver` from `<install>\win_b64\code\bin` as administrator.
- Use **late binding** (`win32com.client.Dispatch` / `GetActiveObject`). Avoid
  `gencache.EnsureDispatch` with CATIA: the generated cache often breaks on CATIA's type
  libraries.
- In a worker thread, call `pythoncom.CoInitialize()` first.
- Alternative: the `pycatia` package wraps this same API with Python names. This workbook covers
  the raw COM calls.

```python
import win32com.client, pywintypes

try:
    catia = win32com.client.GetActiveObject("CATIA.Application")   # attach to running CATIA
except pywintypes.com_error:
    catia = win32com.client.Dispatch("CATIA.Application")          # start / attach
catia.Visible = True
catia.DisplayFileAlerts = False     # no "file exists" pop-ups during SaveAs
catia.RefreshDisplay = False        # faster batch builds; set True at the end
```

---

## 4. Translating a recorded VBA/CATScript macro to Python

The **macro recorder** (`Tools > Macro > Start Recording…`, language *CATScript* or *MS VBScript*)
is the ground truth for exact method names and argument order. Record the operation by hand once,
then translate it.

| VBA / CATScript | Python |
|---|---|
| `Set x = y` | `x = y` |
| `CATIA` | `catia` (your Application object) |
| `obj.Method a, b` (no parentheses) | `obj.Method(a, b)` |
| `obj.Method` (no args) | `obj.Method()` if it is a method, `obj.Prop` if a property |
| `Nothing` | `None` (or `NOTHING`, section 5) |
| `True` / `False` | `True` / `False` |
| `Dim arr(8)` + `arr(0) = …` | a 9-element tuple `(…)` |
| `Set sketch1Variant = sketch1` | not needed (VBA typing workaround) |
| `catCstTypeOn`, `catUpToLastLimit`, … | integer constants (section 5) |
| `For i = 1 To coll.Count` | `for i in range(1, coll.Count + 1):` |
| `"a" & "b"` | `"a" + "b"` or an f-string |
| `0.000000` | `0.0` |
| `obj.Method arr` where `arr` is filled by the call | `get_array(catia, obj, "Method", size)` |

Example: recorded VBA

```vb
Set part1 = CATIA.ActiveDocument.Part
Set body1 = part1.Bodies.Item("PartBody")
Set reference1 = part1.OriginElements.PlaneXY
Set sketch1 = body1.Sketches.Add(reference1)
Dim arrayOfVariantOfDouble1(8)
arrayOfVariantOfDouble1(0) = 0.000000 ' ... (9 values)
Set sketch1Variant = sketch1
sketch1Variant.SetAbsoluteAxisData arrayOfVariantOfDouble1
Set factory2D1 = sketch1.OpenEdition()
Set circle2D1 = factory2D1.CreateClosedCircle(0.000000, 0.000000, 25.000000)
sketch1.CloseEdition
part1.InWorkObject = body1
Set pad1 = part1.ShapeFactory.AddNewPad(sketch1, 20.000000)
part1.Update
```

Python

```python
part = catia.ActiveDocument.Part
body = part.MainBody
sketch = body.Sketches.Add(part.CreateReferenceFromObject(part.OriginElements.PlaneXY))
sketch.SetAbsoluteAxisData((0, 0, 0, 1, 0, 0, 0, 1, 0))
f2d = sketch.OpenEdition()
f2d.CreateClosedCircle(0.0, 0.0, 25.0)
sketch.CloseEdition()
part.InWorkObject = body
pad = part.ShapeFactory.AddNewPad(sketch, 20.0)
part.Update()
```

---

## 5. `catia_helpers.py` (constants and helpers; save it next to every script)

```python
"""catia_helpers.py - shared constants and helpers for CATIA V5 COM automation."""
import pythoncom
import pywintypes
import win32com.client

# ---------- CatConstraintType (sketch AND assembly constraints) ----------
catCstTypeReference = 0             # fix (assembly) / reference
catCstTypeDistance = 1              # distance / offset
catCstTypeOn = 2                    # coincidence
catCstTypeConcentricity = 3
catCstTypeTangency = 4
catCstTypeLength = 5
catCstTypeAngle = 6
catCstTypePlanarAngle = 7
catCstTypeParallelism = 8
catCstTypeAxisParallelism = 9
catCstTypeHorizontality = 10
catCstTypePerpendicularity = 11
catCstTypeAxisPerpendicularity = 12
catCstTypeVerticality = 13
catCstTypeRadius = 14
catCstTypeSymmetry = 15
catCstTypeMidPoint = 16
catCstTypeEquidistance = 17
catCstTypeMajorRadius = 18
catCstTypeMinorRadius = 19
catCstTypeSurfContact = 20          # surface contact (assembly)
catCstTypeLinContact = 21
catCstTypePoncContact = 22
catCstTypeChamfer = 23
catCstTypeChamferPerpend = 24
catCstTypeAnnulContact = 25
catCstTypeCylinderRadius = 26

# CatConstraintOrientation / CatConstraintMode
catCstOrientSame = 0
catCstOrientOpposite = 1
catCstModeDrivingDimension = 0      # ⚠ verify
catCstModeDrivenDimension = 1       # ⚠ verify

# CatLimitMode (Pad / Pocket limits, Hole bottom limit)
catOffsetLimit = 0                  # "Dimension"
catUpToNextLimit = 1
catUpToLastLimit = 2                # through all
catUpToPlaneLimit = 3
catUpToSurfaceLimit = 4
catUpThruNextLimit = 5              # ⚠ verify

# CatPrismOrientation (Pad / Pocket direction)
catRegularOrientation = 0
catInverseOrientation = 1

# CatFilletEdgePropagation
catMinimalFilletEdgePropagation = 0
catTangencyFilletEdgePropagation = 1

# Chamfer: CatChamferPropagation / CatChamferMode / CatChamferOrientation
catTangencyChamfer = 0
catMinimalChamfer = 1
catLengthAngleChamfer = 0
catTwoLengthChamfer = 1
catNoReverseChamfer = 0
catReverseChamfer = 1

# CatHoleType / CatHoleBottomType
catSimpleHole = 0
catTaperedHole = 1
catCounterboredHole = 2
catCountersunkHole = 3
catCounterdrilledHole = 4
catFlatHoleBottom = 0
catVHoleBottom = 1

# CatSplitSide (Part Design solid split) - ⚠ verify; if the wrong side is kept, use the other value
catPositiveSide = 0
catNegativeSide = 1

# CatVisPropertyShow (Selection.VisProperties.SetShow)
catVisPropertyShowAttr = 0
catVisPropertyNoShowAttr = 1

# CatWorkModeType (Product.ApplyWorkMode) - ⚠ verify
DEFAULT_MODE = 0
VISUALIZATION_MODE = 1
DESIGN_MODE = 2

# CATScriptLanguage (SystemService.Evaluate)
CATVBScriptLanguage = 0

# Sketch axis data for SetAbsoluteAxisData: origin(3), H direction(3), V direction(3)
AXIS_XY = (0, 0, 0, 1, 0, 0, 0, 1, 0)
AXIS_YZ = (0, 0, 0, 0, 1, 0, 0, 0, 1)
AXIS_ZX = (0, 0, 0, 0, 0, 1, 1, 0, 0)

# VBA "Nothing" for optional object arguments when plain None is rejected
NOTHING = win32com.client.VARIANT(pythoncom.VT_DISPATCH, None)


def get_catia(visible=True):
    """Attach to a running CATIA V5 session, or start one."""
    try:
        catia = win32com.client.GetActiveObject("CATIA.Application")
    except pywintypes.com_error:
        catia = win32com.client.Dispatch("CATIA.Application")
    catia.Visible = visible
    return catia


def ref(part, obj):
    """Reference to a part object: the input type most factory methods require."""
    return part.CreateReferenceFromObject(obj)


def update(part, obj=None):
    """Update one feature (or the whole part); raise with the failing feature's name."""
    try:
        if obj is None:
            part.Update()
        else:
            part.UpdateObject(obj)
    except pywintypes.com_error as e:
        name = "Part" if obj is None else obj.Name
        raise RuntimeError(f"CATIA update failed on '{name}': {e}") from e


def new_sketch(part, sketches, plane, axis_data=None):
    """sketches: body.Sketches or geo_set.HybridSketches. plane: plane object (not a Reference)."""
    sketch = sketches.Add(part.CreateReferenceFromObject(plane))
    if axis_data is not None:
        sketch.SetAbsoluteAxisData(axis_data)
    return sketch


def closed_polyline(f2d, pts):
    """Closed, connected profile through [(h, v), ...] (do not repeat the first point)."""
    corners = [f2d.CreatePoint(h, v) for h, v in pts]
    lines = []
    for i, (h1, v1) in enumerate(pts):
        j = (i + 1) % len(pts)
        h2, v2 = pts[j]
        line = f2d.CreateLine(h1, v1, h2, v2)
        line.StartPoint = corners[i]
        line.EndPoint = corners[j]
        lines.append(line)
    return lines


def rectangle(f2d, h1, v1, h2, v2):
    """Axis-aligned rectangle; returns [bottom, right, top, left] Line2D (h1<h2, v1<v2)."""
    return closed_polyline(f2d, [(h1, v1), (h2, v1), (h2, v2), (h1, v2)])


def add_gsd(part, geo_set, shape, name=None, hide=False):
    """Append a HybridShapeFactory result to a geometrical set, name it and update it."""
    geo_set.AppendHybridShape(shape)
    if name:
        shape.Name = name
    update(part, shape)
    if hide:
        part.HybridShapeFactory.GSMVisibility(part.CreateReferenceFromObject(shape), 0)
    return shape


def vb_eval(catia, code, func_name, *args):
    """Run a VBScript function inside CATIA and return its result."""
    return catia.SystemService.Evaluate(code, CATVBScriptLanguage, func_name, list(args))


def get_array(catia, obj, method, size):
    """Call a method that fills an output array, e.g. GetCoordinates (3), GetComponents (12)."""
    code = (
        "Function GetArr(o)\n"
        f"  Dim a({size - 1})\n"
        f"  o.{method} a\n"
        "  GetArr = a\n"
        "End Function\n"
    )
    return tuple(vb_eval(catia, code, "GetArr", obj))


def com_type(catia, obj):
    """CATIA automation type name of an object, e.g. 'Pad', 'HybridShapePlaneOffset'."""
    code = "Function TN(o)\n  TN = TypeName(o)\nEnd Function\n"
    return vb_eval(catia, code, "TN", obj)
```

---

## 6. Application and documents

| Task | Code |
|---|---|
| New part / product / drawing | `catia.Documents.Add("Part")`, `Add("Product")`, `Add("Drawing")` |
| Open | `doc = catia.Documents.Open(r"C:\work\a.CATPart")` |
| Active document | `doc = catia.ActiveDocument` (raises if nothing is open) |
| Loaded document by name | `catia.Documents.Item("a.CATPart")`, `catia.Documents.Count` |
| Part / root product | `doc.Part` (CATPart), `doc.Product` (CATProduct; a CATPart also has `.Product`) |
| Is it a part? | `doc.Name.lower().endswith(".catpart")` |
| Save | `doc.Save()`, `doc.SaveAs(r"C:\work\b.CATPart")` (include the extension) |
| Export | `doc.ExportData(r"C:\work\b.stp", "stp")` (also `"igs"`, `"stl"`) |
| Close | `doc.Close()` |
| File info | `doc.Name`, `doc.FullName`, `doc.Path` |
| Fit view | `catia.ActiveWindow.ActiveViewer.Reframe()` |
| No pop-ups / fast | `catia.DisplayFileAlerts = False`, `catia.RefreshDisplay = False` |
| Quit | `catia.Quit()` |

Switching workbenches is **not** needed for automation: factories work from any workbench.

---

## 7. Part, bodies, references, update

| Task | Code |
|---|---|
| Main body (any UI language) | `body = part.MainBody` |
| Body by name | `part.Bodies.Item("PartBody")` (the name is language-dependent) |
| New body | `b = part.Bodies.Add(); b.Name = "Tool"` |
| Origin planes | `part.OriginElements.PlaneXY`, `.PlaneYZ`, `.PlaneZX` |
| New geometrical set | `gs = part.HybridBodies.Add(); gs.Name = "Wireframe"` |
| Nested set | `sub = gs.HybridBodies.Add()` |
| Existing set | `part.HybridBodies.Item("Geometrical Set.1")` |
| Features of a body | `body.Shapes.Item(i)`, `body.Shapes.Count` |
| Sketches | `body.Sketches.Item("Sketch.1")`; sketches inside a set: `gs.HybridSketches` |
| GSD elements of a set | `gs.HybridShapes.Item("Point.1")`, `.Count` |
| Wireframe inside a body | `body.InsertHybridShape(shape)` |
| Find by name | `part.FindObjectByName("Pad.1")` |
| Reference from object | `part.CreateReferenceFromObject(obj)` |
| Reference to face/edge | `part.CreateReferenceFromBRepName(brep_name, feature)` (section 12) |
| Insertion point | `part.InWorkObject = body` (or a feature, to insert after it) |
| Update | `part.Update()`, `part.UpdateObject(obj)`, `part.IsUpToDate(obj)` |
| Deactivate / activate | `part.Inactivate(feature)`, `part.Activate(feature)` |
| Rename | `obj.Name = "NewName"` |
| Delete | `sel = doc.Selection; sel.Clear(); sel.Add(obj); sel.Delete()` |
| Factories | `sf = part.ShapeFactory`, `hsf = part.HybridShapeFactory` |

---

## 8. Sketcher (Factory2D)

### 8.1 Create and position a sketch

```python
sketch = body.Sketches.Add(ref(part, part.OriginElements.PlaneXY))  # in a body
# sketch = gs.HybridSketches.Add(ref(part, plane))                  # in a geometrical set
sketch.SetAbsoluteAxisData(AXIS_XY)    # origin, H, V - always set it explicitly
f2d = sketch.OpenEdition()
# ... create 2D geometry and constraints ...
sketch.CloseEdition()
```

Sketch coordinates are 2D **(H, V)**, not 3D (X, Y, Z):

| Support | Axis data | H = | V = |
|---|---|---|---|
| PlaneXY | `AXIS_XY` | +X | +Y |
| PlaneYZ | `AXIS_YZ` | +Y | +Z |
| PlaneZX | `AXIS_ZX` | +Z | +X |
| Offset plane at Z = 20 | `(0, 0, 20, 1, 0, 0, 0, 1, 0)` | +X | +Y |

Any plane can be a support: origin planes, GSD planes, or planar faces given as References.

### 8.2 Factory2D methods

| Method | Returns | Notes |
|---|---|---|
| `CreatePoint(h, v)` | Point2D | corners, hole centres |
| `CreateLine(h1, v1, h2, v2)` | Line2D | connect with `.StartPoint` / `.EndPoint` |
| `CreateClosedCircle(ch, cv, r)` | Circle2D | full circle |
| `CreateCircle(ch, cv, r, a_start, a_end)` | Circle2D | arc, **radians**, counter-clockwise |
| `CreateClosedEllipse(ch, cv, mh, mv, R, r)` | Ellipse2D | (mh, mv) = major axis direction |
| `CreateEllipse(ch, cv, mh, mv, R, r, a_start, a_end)` | Ellipse2D | arc, radians |
| `CreateControlPoint(h, v)` | ControlPoint2D | for splines |
| `CreateSpline((cp1, cp2, cp3))` | Spline2D | tuple of control points |
| `CreateProjection(reference_3d)` | Geometry2D | project 3D geometry into the sketch ⚠ verify |
| `CreateIntersection(reference_3d)` | Geometry2D | ⚠ verify |

There is **no** `CreateRectangle`. Use 4 connected lines (`rectangle()` helper).

### 8.3 2D geometry properties

| Property | Use |
|---|---|
| `line.StartPoint = p`, `line.EndPoint = p` | share Point2D between segments so the profile is closed |
| `arc.CenterPoint`, `arc.StartPoint`, `arc.EndPoint` | connect arcs to lines |
| `geom.Construction = True` | construction element, ignored by Pad/Pocket |
| `sketch.CenterLine = line` | axis for Shaft / Groove |
| `sketch.AbsoluteAxis.HorizontalReference`, `.VerticalReference`, `.Origin` | sketch axes, usable in constraints |
| `sketch.GeometricElements` | collection of all 2D elements |

Arc tangent to two lines (rounded corner): create the arc with `CreateCircle` and set its
`StartPoint`/`EndPoint` to the line ends, then add `catCstTypeTangency` constraints.

### 8.4 Sketch constraints (inside OpenEdition/CloseEdition)

```python
csts = sketch.Constraints
c = csts.AddMonoEltCst(catCstTypeLength, ref(part, line))          # one element
c.Dimension.Value = 100.0
csts.AddMonoEltCst(catCstTypeHorizontality, ref(part, line))
csts.AddMonoEltCst(catCstTypeRadius, ref(part, circle)).Dimension.Value = 10.0
d = csts.AddBiEltCst(catCstTypeDistance, ref(part, pt), ref(part, sketch.AbsoluteAxis.VerticalReference))
d.Dimension.Value = 25.0
csts.AddBiEltCst(catCstTypeOn, ref(part, pt), ref(part, line))       # coincidence
csts.AddBiEltCst(catCstTypeTangency, ref(part, arc), ref(part, line))
csts.AddTriEltCst(catCstTypeSymmetry, ref(part, p1), ref(part, p2), ref(part, axis_line))
```

| Kind | Method | Types |
|---|---|---|
| 1 element | `AddMonoEltCst(type, r)` | Length, Radius, Horizontality, Verticality, Reference (fix) |
| 2 elements | `AddBiEltCst(type, r1, r2)` | Distance, On, Tangency, Parallelism, Perpendicularity, Angle, Concentricity |
| 3 elements | `AddTriEltCst(type, r1, r2, r3)` | Symmetry (r1, r2 about r3) |

If setting `Dimension.Value` has no effect, set `c.Mode = catCstModeDrivingDimension` (⚠ verify).

---

## 9. Part Design (`part.ShapeFactory`)

Set `part.InWorkObject = body` before creating features. Every feature is inserted after the
in-work object.

### 9.1 Sketch-based features

| Method | Returns | Notes |
|---|---|---|
| `AddNewPad(sketch, length)` | Pad | extrudes along the sketch normal |
| `AddNewPadFromRef(profile_ref, length)` | Pad | profile = sketch or GSD curve reference |
| `AddNewPocket(sketch, depth)` | Pocket | default direction is opposite to the sketch normal |
| `AddNewPocketFromRef(profile_ref, depth)` | Pocket | |
| `AddNewShaft(sketch)` | Shaft | axis from `sketch.CenterLine` or `shaft.RevoluteAxis = ref` |
| `AddNewShaftFromRef(profile_ref)` | Shaft | |
| `AddNewGroove(sketch)` | Groove | revolved cut, same axis rules |
| `AddNewGrooveFromRef(profile_ref)` | Groove | |
| `AddNewHole(support_ref, depth)` | Hole | support = planar face reference |
| `AddNewHoleFromPoint(x, y, z, support_ref, depth)` | Hole | |
| `AddNewHoleFromRefPoint(point_ref, support_ref, depth)` | Hole | |
| `AddNewHoleFromSketch(sketch, depth)` | Hole | sketch containing the hole centre point ⚠ verify |
| `AddNewHoleWithConstraint(x, y, z, edge_ref, support_ref, depth)` | Hole | concentric to a circular edge |
| `AddNewHoleWith2Constraints(x, y, z, edge1_ref, edge2_ref, support_ref, depth)` | Hole | distances to 2 edges |
| `AddNewRib(profile_sketch, center_curve_sketch)` | Rib | sweep of a profile along a curve |
| `AddNewRibFromRef(profile_ref, center_curve_ref)` | Rib | |
| `AddNewSlot(profile_sketch, center_curve_sketch)` | Slot | swept cut |
| `AddNewSlotFromRef(profile_ref, center_curve_ref)` | Slot | |
| `AddNewStiffener(sketch)` | Stiffener | |
| `AddNewLoft()` | Loft | multi-sections solid; sections via `loft.HybridShape` (below) |
| `AddNewRemovedLoft()` | RemovedLoft | removed multi-sections solid ⚠ verify |

**Tip:** a hole needs a B-rep face reference. A Pocket of a `CreateClosedCircle` sketch with
`catUpToLastLimit` makes the same through-hole without one.

Multi-sections solid:

```python
loft = sf.AddNewLoft()
hl = loft.HybridShape            # HybridShapeLoft
hl.SectionCoupling = 1
hl.Relimitation = 1
hl.CanonicalDetection = 2
hl.AddSectionToLoft(ref(part, sketch_bottom), 1, None)   # (section, orientation 1/-1, closing point)
hl.AddSectionToLoft(ref(part, sketch_top), 1, None)
update(part, loft)
```

### 9.2 Feature properties

| Feature | Properties / methods |
|---|---|
| Pad, Pocket | `.FirstLimit.Dimension.Value`, `.FirstLimit.LimitMode` (CatLimitMode), `.FirstLimit.LimitingElement = ref` (up to plane/surface), `.SecondLimit.Dimension.Value`, `.SecondLimit.LimitMode`, `.IsSymmetric = True`, `.DirectionOrientation = catInverseOrientation` |
| Shaft, Groove | `.FirstAngle.Value`, `.SecondAngle.Value`, `.RevoluteAxis = ref` |
| Hole | `.Diameter.Value`, `.BottomLimit.Dimension.Value`, `.BottomLimit.LimitMode`, `.Type` (CatHoleType), `.BottomType`, `.BottomAngle.Value`, `.HeadDiameter.Value` / `.HeadDepth.Value` (counterbore), `.HeadAngle.Value` (countersink), `.Reverse()`, `.Sketch` (positioning sketch) |
| Any feature | `.Name`, `part.UpdateObject(f)`, `part.Inactivate(f)` |

### 9.3 Dress-up features

| Method | Returns | Notes |
|---|---|---|
| `AddNewSolidEdgeFilletWithConstantRadius(edge_ref, propagation, radius)` | ConstRadEdgeFillet | the form current recorders produce |
| `AddNewEdgeFilletWithConstantRadius(edge_ref, propagation, radius)` | ConstRadEdgeFillet | older form |
| `AddNewSolidEdgeFilletWithVaryingRadius(edge_ref, propagation, variation, radius)` | VarRadEdgeFillet | ⚠ verify |
| `AddNewFaceFillet(face1_ref, face2_ref, radius)` | FaceFillet | |
| `AddNewTritangentFillet(face1_ref, face2_ref, removed_face_ref)` | TritangentFillet | ⚠ verify |
| `AddNewChamfer(edge_ref, propagation, mode, orientation, length1, length2_or_angle)` | Chamfer | e.g. `(r, catTangencyChamfer, catLengthAngleChamfer, catNoReverseChamfer, 1.0, 45.0)` |
| `AddNewDraft(face_ref, neutral_ref, neutral_mode, parting_ref, dx, dy, dz, mode, angle, multiselection_mode)` | Draft | record a macro for the modes ⚠ verify |
| `AddNewShell(face_to_remove_ref, inner_thickness, outer_thickness)` | Shell | |
| `AddNewThickness(face_ref, offset)` | Thickness | |

Follow-up calls: `fillet.AddObjectToFillet(edge_ref)`, `fillet.Radius.Value`,
`chamfer.AddElementToChamfer(edge_ref)`, `shell.AddFaceToRemove(face_ref)`,
`shell.InternalThickness.Value`.

### 9.4 Patterns and mirror

| Method | Returns |
|---|---|
| `AddNewRectPattern(feature, n1, n2, step1, step2, pos1, pos2, dir1_ref, dir2_ref, reverse1, reverse2, rotation_angle)` | RectPattern |
| `AddNewCircPattern(feature, n_radial, n_angular, step_radial, step_angular, pos_radial, pos_angular, center_ref, axis_ref, reverse_axis, rotation_angle, radius_aligned)` | CircPattern |
| `AddNewUserPattern(feature, n)` | UserPattern ⚠ verify |
| `AddNewMirror(plane_ref)` | Mirror (mirrors the current body up to the in-work object ⚠ verify; record a macro to mirror a single feature) |

- `pos1` / `pos2` = 1-based position of the original inside the grid (usually `1, 1`).
- Direction refs: GSD lines, straight edges or sketch axes.
- Example: 6 holes every 60° about Z:
  `sf.AddNewCircPattern(pocket, 1, 6, 0.0, 60.0, 1, 1, ref(part, origin_pt), ref(part, z_line), False, 0.0, True)`
- Editing counts after creation (⚠ verify):
  `rect.FirstDirectionRepartition.InstancesCount.Value`,
  `circ.AngularRepartition.InstancesCount.Value`,
  `circ.AngularRepartition.AngularSpacing.Value`.

### 9.5 Booleans (multi-body)

Set the **target** body as in-work object, then add the **tool** body:

```python
part.InWorkObject = part.MainBody
sf.AddNewAdd(tool_body)          # also AddNewRemove, AddNewIntersect, AddNewAssemble
part.Update()
```

`AddNewTrim(body)` also exists (⚠ verify).

### 9.6 Surface-based features (use GSD surfaces)

| Method | Returns | Notes |
|---|---|---|
| `AddNewSplit(surface_ref, side)` | Split | `catPositiveSide` / `catNegativeSide` ⚠ verify which side is kept |
| `AddNewThickSurface(surface_ref, side, offset1, offset2)` | ThickSurface | thicken a surface into a solid |
| `AddNewCloseSurface(surface_ref)` | CloseSurface | closed surface → solid |
| `AddNewSewSurface(surface_ref, side)` | SewSurface | |

### 9.7 Solid transformations (⚠ verify, record a macro)

`AddNewTranslate2`, `AddNewRotate2`, `AddNewSymmetry2`, `AddNewScaling2` (plus older forms
without the `2`). Their arguments changed across releases: copy the exact call from a recording.

---

## 10. Generative Shape Design (`part.HybridShapeFactory`)

Workflow for **every** element:
**create with `hsf.AddNew…` → `geo_set.AppendHybridShape(shape)` → `part.UpdateObject(shape)`.**
`add_gsd(part, gs, shape, name, hide)` does all three. Inputs are References.
Directions are `HybridShapeDirection` objects, which are not appended.

### 10.1 Directions

| Method | Notes |
|---|---|
| `AddNewDirectionByCoord(x, y, z)` | vector |
| `AddNewDirection(line_or_plane_ref)` | along a line / normal of a plane |

### 10.2 Points

| Method | Returns |
|---|---|
| `AddNewPointCoord(x, y, z)` | HybridShapePointCoord (`.X.Value`, `.Y.Value`, `.Z.Value`) |
| `AddNewPointCoordWithReference(x, y, z, ref_point)` | relative to a point |
| `AddNewPointOnCurveFromDistance(curve_ref, distance, reverse)` | HybridShapePointOnCurve |
| `AddNewPointOnCurveFromPercent(curve_ref, ratio_0_to_1, reverse)` | |
| `AddNewPointOnCurveWithReferenceFromDistance(curve_ref, ref_point, distance, reverse)` | |
| `AddNewPointOnCurveWithReferenceFromPercent(curve_ref, ref_point, ratio, reverse)` | |
| `AddNewPointOnPlane(plane_ref, h, v)` | HybridShapePointOnPlane |
| `AddNewPointOnPlaneWithReference(plane_ref, ref_point, h, v)` | |
| `AddNewPointOnSurface(surface_ref, direction, distance)` | |
| `AddNewPointOnSurfaceWithReference(surface_ref, ref_point, direction, distance)` | |
| `AddNewPointCenter(circle_ref)` | centre of a circle/arc |
| `AddNewPointTangent(curve_ref, direction)` | tangent point |
| `AddNewPointBetween(p1_ref, p2_ref, ratio, orientation)` | ⚠ verify orientation type |

### 10.3 Lines

| Method | Notes |
|---|---|
| `AddNewLinePtPt(p1_ref, p2_ref)` | |
| `AddNewLinePtPtExtended(p1_ref, p2_ref, begin_offset, end_offset)` | |
| `AddNewLinePtPtOnSupport(p1_ref, p2_ref, support_ref)` | geodesic on a surface |
| `AddNewLinePtDir(point_ref, direction, begin_offset, end_offset, reverse)` | axis lines |
| `AddNewLinePtDirOnSupport(point_ref, direction, support_ref, begin_offset, end_offset, reverse)` | |
| `AddNewLineAngle(curve_ref, surface_ref, point_ref, geodesic, begin_offset, end_offset, angle, reverse)` | |
| `AddNewLineNormal(surface_ref, point_ref, begin_offset, end_offset, reverse)` | normal to a surface |
| `AddNewLineTangency(curve_ref, point_ref, begin_offset, end_offset, reverse)` | tangent to a curve |
| `AddNewLineBisecting(line1_ref, line2_ref, begin_offset, end_offset, reverse)` | ⚠ verify |

### 10.4 Planes

| Method | Notes |
|---|---|
| `AddNewPlaneOffset(plane_ref, offset, reverse)` | `.Offset.Value` |
| `AddNewPlaneOffsetPt(plane_ref, point_ref)` | parallel through a point |
| `AddNewPlaneAngle(plane_ref, axis_ref, angle, reverse)` | rotated about a line |
| `AddNewPlane3Points(p1_ref, p2_ref, p3_ref)` | |
| `AddNewPlane2Lines(l1_ref, l2_ref)` | |
| `AddNewPlanePointLine(point_ref, line_ref)` | |
| `AddNewPlaneNormal(curve_ref, point_ref)` | normal to a curve at a point |
| `AddNewPlaneTangent(surface_ref, point_ref)` | |
| `AddNewPlaneEquation(a, b, c, d)` | ax + by + cz = d |
| `AddNewPlaneThroughPlanarCurve(curve_ref)` | ⚠ verify |

### 10.5 Curves

| Method | Notes |
|---|---|
| `AddNewCircleCtrRad(center_ref, support_ref, geodesic, radius)` | then `.SetLimitation(1)` for a full circle ⚠ verify; `.Radius.Value` |
| `AddNewCircleCtrPt(center_ref, point_ref, support_ref, geodesic)` | |
| `AddNewCircle3Points(p1_ref, p2_ref, p3_ref)` | |
| `AddNewSpline()` | then `.AddPoint(point_ref)` per point, `.SetClosing(0 or 1)` |
| `AddNewPolyline()` | then `.InsertElement(point_ref, position_1_based)` ⚠ verify |
| `AddNewHelix(axis_ref, invert_axis, start_point_ref, pitch, height, clockwise, start_angle, taper_angle, taper_outward)` | |
| `AddNewCurvePar(curve_ref, support_ref, offset, invert, geodesic)` | parallel curve on a support |
| `AddNewCorner(e1_ref, e2_ref, support_ref, radius, orientation1, orientation2, trim)` | 2D fillet of curves ⚠ verify |
| `AddNewIntersection(e1_ref, e2_ref)` | curve or point |
| `AddNewProject(element_ref, support_ref)` | `.Normal = True` for normal projection |
| `AddNewBoundaryOfSurface(surface_ref)` | boundary curve |
| `AddNewExtract(sub_element_ref)` | extract a face/edge as a datum-like feature |
| `AddNewConnect(…)` | connect curve: many arguments, record a macro |

### 10.6 Surfaces

| Method | Notes |
|---|---|
| `AddNewExtrude(profile_ref, length1, length2, direction)` | HybridShapeExtrude |
| `AddNewRevol(profile_ref, angle1, angle2, axis_ref)` | HybridShapeRevol, degrees |
| `AddNewCylinder(center_ref, radius, length1, length2, direction)` | |
| `AddNewSphere(center_ref, axis_ref, radius, par_start, par_end, mer_start, mer_end)` | `axis_ref` may be `None`/`NOTHING` ⚠ verify |
| `AddNewOffset(surface_ref, offset, reverse, precision)` | e.g. `(r, 2.0, True, 0.01)` |
| `AddNewSweepExplicit(profile_ref, guide_ref)` | profile swept along a guide |
| `AddNewSweepLine(guide_ref)`, `AddNewSweepCircle(guide_ref)`, `AddNewSweepConic(guide_ref)` | many properties to set: record a macro |
| `AddNewLoft()` | then `.AddSectionToLoft(ref, 1, None)` per section, `.AddGuide(ref)` |
| `AddNewFill()` | then `.AddBound(curve_ref)` per boundary curve |
| `AddNewBlend()` | record a macro ⚠ verify |

### 10.7 Operations

| Method | Notes |
|---|---|
| `AddNewJoin(r1, r2)` | HybridShapeAssemble; `.AddElement(r3)`, `.SetConnex(1)`, `.SetDeviation(0.001)` |
| `AddNewHybridSplit(element_ref, cutting_ref, orientation)` | orientation `1` or `-1` (which side is kept) |
| `AddNewHybridTrim(e1_ref, orient1, e2_ref, orient2)` | orientations `1` / `-1` |
| `AddNewFilletBiTangent(s1_ref, s2_ref, radius, orient1, orient2, trim_mode, ends_mode)` | ⚠ verify |
| `AddNewExtrapolLength(boundary_ref, element_ref, length)` | ⚠ verify |

### 10.8 Transformations

| Method | Notes |
|---|---|
| `AddNewTranslate(element_ref, direction, distance)` | or `AddNewEmptyTranslate()` + properties |
| `AddNewRotate(element_ref, axis_ref, angle)` | |
| `AddNewSymmetry(element_ref, mirror_ref)` | plane / line / point |
| `AddNewHybridScaling(element_ref, center_ref, ratio)` | ⚠ verify |
| `AddNewAxisToAxis(element_ref, from_axis_ref, to_axis_ref)` | ⚠ verify |

### 10.9 Utilities

| Task | Code |
|---|---|
| Hide / show | `hsf.GSMVisibility(ref(part, shape), 0)` / `1` |
| Delete a GSD feature | `hsf.DeleteObjectForDatum(ref(part, shape))` |
| Use in Part Design | pass `ref(part, surface)` to `AddNewSplit`, `AddNewThickSurface`, `AddNewPadFromRef`, … |

---

## 11. Parameters and formulas

```python
params = part.Parameters
L = params.CreateDimension("Box_L", "LENGTH", 100.0)   # magnitude: "LENGTH", "ANGLE", "MASS", ...
n = params.CreateInteger("Hole_Count", 6)
k = params.CreateReal("Factor", 1.5)
s = params.CreateString("Material_Note", "S235")
b = params.CreateBoolean("Has_Holes", True)

L.Value = 120.0                    # mm
L.ValuateFromString("120mm")
print(L.ValueAsString())
p = params.Item("Box_L")           # by name (feature params: r"PartBody\Pad.1\FirstLimit\Length")

rel = part.Relations
rel.CreateFormula("f_pad", "", pad.FirstLimit.Dimension, "Box_L / 2")   # (name, comment, output, body)
part.Update()
```

- Output parameters for formulas: `pad.FirstLimit.Dimension`, `constraint.Dimension`,
  `plane_offset.Offset`, `shaft.FirstAngle`, …
- Name user parameters without spaces (`Box_L`) so formula bodies can refer to them directly.
- Parameter sets: `params.RootParameterSet.ParameterSets.CreateSet("Inputs")` ⚠ verify.
- Rules, checks and design tables: `rel.CreateProgram(...)`, `rel.CreateCheck(...)`,
  `rel.CreateDesignTable(...)` ⚠ verify the signatures.

---

## 12. Selection, search, visibility, faces and edges

```python
sel = doc.Selection
sel.Clear()
sel.Add(obj)
for i in range(1, sel.Count + 1):
    item = sel.Item(i)
    obj_i, ref_i = item.Value, item.Reference      # object and Reference
sel.Delete()
sel.VisProperties.SetShow(catVisPropertyNoShowAttr)   # hide (ShowAttr = show)
sel.VisProperties.SetRealColor(255, 0, 0, 1)          # r, g, b, inheritance
```

**Search** (`sel.Search(query)`; scope suffix `,all` = whole document, `,sel` = inside the current
selection):

| Query | Finds |
|---|---|
| `"Name=Pad.1,all"` / `"Name=*Hole*,all"` | by name, wildcards allowed |
| `"CATPrtSearch.Pad,all"` | all Pads, language-independent ⚠ verify |
| `"CATGmoSearch.Point,all"` | all GSD points ⚠ verify |
| `"Topology.CGMEdge,sel"` / `"Topology.CGMFace,sel"` | edges / faces of the selected feature ⚠ verify |

**Copy / paste** between parts:

```python
src.Selection.Clear(); src.Selection.Add(src.Part.MainBody); src.Selection.Copy()
dst.Selection.Clear(); dst.Selection.Add(dst.Part)
dst.Selection.PasteSpecial("CATPrtResultWithOutLink")  # "CATPrtResult" = with link, "CATPrtCont" = as specified
```

### Getting face / edge references (needed for fillet, chamfer, hole, shell, draft)

Faces and edges are not features, so `CreateReferenceFromObject` cannot reach them. Four ways,
from most to least robust:

1. **Avoid them.** Round corners in the sketch (arcs), make holes as pockets, and sketch on GSD
   planes instead of faces.
2. **Ask the user** to pick:
   ```python
   sel.Clear()
   status = sel.SelectElement2(("Edge",), "Select an edge to fillet", False)  # filter, prompt, use preselection
   if status == "Normal":                                                      # "Cancel" / "Undo" otherwise
       edge_ref = sel.Item(1).Reference
   ```
   Filter names: `"Face"`, `"PlanarFace"`, `"Edge"`, `"Vertex"`, `"Plane"`, `"HybridShape"`,
   `"Sketch"`, `"Body"`, `"Product"`, `"AnyObject"`. `SelectElement3`/`4` are unreliable from
   Python.
3. **Topology search** (⚠ verify):
   ```python
   def feature_edges(doc, feature):
       sel = doc.Selection
       sel.Clear(); sel.Add(feature)
       sel.Search("Topology.CGMEdge,sel")
       refs = [sel.Item(i).Reference for i in range(1, sel.Count + 1)]
       sel.Clear()
       return refs
   ```
4. **B-rep name from a recorded macro** (fragile: breaks if the model topology changes):
   ```python
   face = part.CreateReferenceFromBRepName(
       "RSur:(Face:(Brp:(Pad.1;2);None:();Cf11:());WithTemporaryBody;WithoutBuildError;"
       "WithSelectingFeatureSupport;MFBRepVersion_CXR15)", pad)   # copy the exact string from your recording
   ```

---

## 13. Measurement and output-array methods

```python
spa = doc.GetWorkbench("SPAWorkbench")
m = spa.GetMeasurable(ref(part, part.MainBody))
volume, area = m.Volume, m.Area            # ⚠ verify units (often m³ / m²): measure a known cube once
m_edge = spa.GetMeasurable(edge_ref)
length = m_edge.Length                     # mm
dist = m.GetMinimumDistance(other_ref)     # mm, scalar return: direct call is fine
cog = get_array(catia, m, "GetCOG", 3)     # array output: use get_array
```

Methods that fill an output array; call them with `get_array(catia, obj, name, size)`:

| Object | Method | Size |
|---|---|---|
| Measurable | `GetCOG`, `GetPoint`, `GetDirection`, `GetCenter` | 3 |
| Measurable | `GetPlane` (origin, dir1, dir2) | 9 |
| GSD point | `GetCoordinates` | 3 |
| Point2D | `GetCoordinates` | 2 |
| Sketch | `GetAbsoluteAxisData` | 9 |
| Product.Position | `GetComponents` | 12 |
| Product.Analyze | `GetGravityCenter` | 3 |
| Product.Analyze | `GetInertia` | 9 |

`com_type(catia, obj)` returns the automation type name (`"Pad"`, `"HybridShapeExtrude"`, …),
which helps debug "wrong object" errors.

---

## 14. Assembly Design

### 14.1 Products collection (`product.Products`)

| Method | Returns | Notes |
|---|---|---|
| `AddNewComponent("Part", part_number)` | Product (instance) | new CATPart in memory |
| `AddNewComponent("Product", part_number)` | Product | new sub-assembly CATProduct |
| `AddNewProduct(part_number)` | Product | component stored inside the parent (no separate file) |
| `AddComponentsFromFiles((path1, path2), "All")` | nothing | new instances are appended: `Item(Count)` |
| `AddComponent(other.ReferenceProduct)` | Product | another instance of an already loaded reference |
| `ReplaceComponent(old_instance, file_path, multi_instances)` | Product | ⚠ verify |
| `Item(i)` / `Item("Part1.1")`, `Count`, `Remove(i_or_name)` | | |

### 14.2 Product properties

| Task | Code |
|---|---|
| Part number (reference) | `inst.PartNumber`, `.Revision`, `.Definition`, `.Nomenclature`, `.DescriptionRef` |
| Instance name | `inst.Name` (e.g. `"BLOCK.1"`) |
| Reference / document | `inst.ReferenceProduct`, `inst.ReferenceProduct.Parent` (Part- or ProductDocument) |
| Part geometry of an instance | `inst.ReferenceProduct.Parent.Part` |
| Load everything | `root.ApplyWorkMode(DESIGN_MODE)` (otherwise `.Parent` may fail in visualization mode) |
| Absolute placement | `inst.Position.SetComponents((xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz))` |
| Relative move | `inst.Move.Apply((…12 values…))` |
| Read placement | `get_array(catia, inst.Position, "GetComponents", 12)` |
| User properties | `inst.ReferenceProduct.UserRefProperties.CreateString("Supplier", "ACME")` |
| Mass properties | `inst.Analyze.Mass`, `.Volume`, `.WetArea` (⚠ verify units; density defaults if no material) |
| Update | `root.Update()` |

`SetComponents` order: **X-axis (3), Y-axis (3), Z-axis (3), origin (3)**, in mm. Rotation about Z:

```python
import math
def pose_rot_z(deg, x=0.0, y=0.0, z=0.0):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (c, s, 0, -s, c, 0, 0, 0, 1, x, y, z)
```

### 14.3 Assembly constraints

```python
csts = root.Connections("CATIAConstraints")
rp = root.PartNumber

def asm_ref(inst, element):          # element = feature or publication name inside the instance
    return root.CreateReferenceFromName(f"{rp}/{inst.Name}/!{element}")

fix = csts.AddMonoEltCst(catCstTypeReference,
                         root.CreateReferenceFromName(f"{rp}/{base.Name}/!{rp}/{base.Name}/"))  # ⚠ verify path
c = csts.AddBiEltCst(catCstTypeOn, asm_ref(base, "xy plane"), asm_ref(block, "xy plane"))   # coincidence
o = csts.AddBiEltCst(catCstTypeDistance, asm_ref(base, "yz plane"), asm_ref(block, "yz plane"))
o.Dimension.Value = 80.0             # offset
o.Orientation = catCstOrientSame     # or catCstOrientOpposite
a = csts.AddBiEltCst(catCstTypeAngle, r1, r2); a.Dimension.Value = 30.0
csts.AddBiEltCst(catCstTypeSurfContact, face1_ref, face2_ref)   # contact
root.Update()
```

- Reference path: `"<root PartNumber>/<instance>/<sub-instance>/!<element name>"`. For nested
  assemblies, list every instance on the way down.
- Origin plane names (`"xy plane"`, …) are UI-language dependent ⚠ verify. **Publications** are
  more robust: publish once inside the part, then refer to the publication name.

```python
pprod = part_doc.Product
pprod.Publications.Add("TOP_FACE")
pprod.Publications.SetDirect("TOP_FACE",
    pprod.CreateReferenceFromName(f"{pprod.PartNumber}/!{feature.Name}"))   # ⚠ verify path
# in the assembly:  asm_ref(inst, "TOP_FACE")
```

### 14.4 Saving an assembly

Save the **new parts first**, then the product:

```python
import os
os.makedirs(r"C:\work\asm", exist_ok=True)
for inst in (base, block):
    inst.ReferenceProduct.Parent.SaveAs(rf"C:\work\asm\{inst.PartNumber}.CATPart")
asm_doc.SaveAs(r"C:\work\asm\BRACKET_ASM.CATProduct")
```

---

## 15. Worked examples (each assumes `from catia_helpers import *`)

### A. Plate with a patterned hole grid (Part Design + GSD construction)

```python
from catia_helpers import *

catia = get_catia()
doc = catia.Documents.Add("Part")
part = doc.Part
body = part.MainBody
sf, hsf = part.ShapeFactory, part.HybridShapeFactory
xy = part.OriginElements.PlaneXY

# Construction geometry
gs = part.HybridBodies.Add()
gs.Name = "Construction"
origin = add_gsd(part, gs, hsf.AddNewPointCoord(0, 0, 0), "Origin", hide=True)
x_dir = add_gsd(part, gs, hsf.AddNewLinePtDir(ref(part, origin), hsf.AddNewDirectionByCoord(1, 0, 0), 0, 100, False), "X_Dir", hide=True)
y_dir = add_gsd(part, gs, hsf.AddNewLinePtDir(ref(part, origin), hsf.AddNewDirectionByCoord(0, 1, 0), 0, 100, False), "Y_Dir", hide=True)
top = add_gsd(part, gs, hsf.AddNewPlaneOffset(ref(part, xy), 20.0, False), "Top_Plane", hide=True)

# 1. Base plate 100 x 60 x 20, centred on the origin
part.InWorkObject = body
sk1 = new_sketch(part, body.Sketches, xy, AXIS_XY)
f2d = sk1.OpenEdition()
rectangle(f2d, -50, -30, 50, 30)
sk1.CloseEdition()
pad = sf.AddNewPad(sk1, 20.0)
pad.Name = "Plate"
update(part, pad)

# 2. Ø8 through hole as a pocket sketched on the top plane
sk2 = new_sketch(part, body.Sketches, top, (0, 0, 20, 1, 0, 0, 0, 1, 0))
f2d = sk2.OpenEdition()
f2d.CreateClosedCircle(-30, -15, 4)
sk2.CloseEdition()
pocket = sf.AddNewPocket(sk2, 10.0)
pocket.FirstLimit.LimitMode = catUpToLastLimit      # through all
# if the update fails because the pocket points away from the material:
# pocket.DirectionOrientation = catInverseOrientation
update(part, pocket)

# 3. 3 x 2 grid, 30 mm pitch
grid = sf.AddNewRectPattern(pocket, 3, 2, 30.0, 30.0, 1, 1,
                            ref(part, x_dir), ref(part, y_dir), False, False, 0.0)
update(part, grid)

part.Update()
catia.ActiveWindow.ActiveViewer.Reframe()
doc.SaveAs(r"C:\work\plate.CATPart")
```

### B. Stepped shaft with a groove (Shaft / Groove)

```python
from catia_helpers import *

catia = get_catia()
doc = catia.Documents.Add("Part")
part = doc.Part
body = part.MainBody
sf = part.ShapeFactory
xy = part.OriginElements.PlaneXY
part.InWorkObject = body

# Half profile in XY (H = X along the shaft, V = Y = radius), revolved about X
sk = new_sketch(part, body.Sketches, xy, AXIS_XY)
f2d = sk.OpenEdition()
sk.CenterLine = f2d.CreateLine(-10, 0, 110, 0)                       # revolution axis
closed_polyline(f2d, [(0, 0), (0, 15), (40, 15), (40, 10), (100, 10), (100, 0)])
sk.CloseEdition()
shaft = sf.AddNewShaft(sk)
shaft.FirstAngle.Value = 360.0
shaft.SecondAngle.Value = 0.0
update(part, shaft)

# 4 mm wide, 2 mm deep ring groove on the Ø20 section
sk2 = new_sketch(part, body.Sketches, xy, AXIS_XY)
f2d = sk2.OpenEdition()
sk2.CenterLine = f2d.CreateLine(-10, 0, 110, 0)
rectangle(f2d, 60, 8, 64, 12)
sk2.CloseEdition()
groove = sf.AddNewGroove(sk2)
groove.FirstAngle.Value = 360.0
update(part, groove)
```

### C. GSD funnel surface, split and thickened into a solid

```python
from catia_helpers import *

catia = get_catia()
doc = catia.Documents.Add("Part")
part = doc.Part
hsf = part.HybridShapeFactory
gs = part.HybridBodies.Add()
gs.Name = "Funnel"

o = add_gsd(part, gs, hsf.AddNewPointCoord(0, 0, 0), "O", hide=True)
a = add_gsd(part, gs, hsf.AddNewPointCoord(40, 0, 0), "A", hide=True)
b = add_gsd(part, gs, hsf.AddNewPointCoord(15, 0, 60), "B", hide=True)
c = add_gsd(part, gs, hsf.AddNewPointCoord(15, 0, 100), "C", hide=True)
ab = add_gsd(part, gs, hsf.AddNewLinePtPt(ref(part, a), ref(part, b)), "AB", hide=True)
bc = add_gsd(part, gs, hsf.AddNewLinePtPt(ref(part, b), ref(part, c)), "BC", hide=True)
z_axis = add_gsd(part, gs, hsf.AddNewLinePtDir(ref(part, o), hsf.AddNewDirectionByCoord(0, 0, 1), 0, 120, False), "Z_Axis", hide=True)

profile = hsf.AddNewJoin(ref(part, ab), ref(part, bc))
profile.SetConnex(1)
add_gsd(part, gs, profile, "Profile", hide=True)

surface = add_gsd(part, gs, hsf.AddNewRevol(ref(part, profile), 360.0, 0.0, ref(part, z_axis)), "Funnel_Surface", hide=True)

cut = add_gsd(part, gs, hsf.AddNewPlaneOffset(ref(part, part.OriginElements.PlaneXY), 90.0, False), "Cut_Plane", hide=True)
trimmed = add_gsd(part, gs, hsf.AddNewHybridSplit(ref(part, surface), ref(part, cut), 1), "Funnel_Trimmed")
# wrong side kept? recreate the split with orientation -1

# Thicken the surface into a 2 mm solid in the main body
part.InWorkObject = part.MainBody
thick = part.ShapeFactory.AddNewThickSurface(ref(part, trimmed), 0, 2.0, 0.0)
update(part, thick)
hsf.GSMVisibility(ref(part, trimmed), 0)
```

More GSD calls (same `add_gsd` pattern; `profile_sketch`, `guide_curve`, `section_1/2` and
`e1…e4` are placeholders for your own elements):

```python
circle = hsf.AddNewCircleCtrRad(ref(part, o), ref(part, part.OriginElements.PlaneXY), False, 25.0)
circle.SetLimitation(1)                                      # full circle ⚠ verify
add_gsd(part, gs, circle, "Circle_R25")
ext = add_gsd(part, gs, hsf.AddNewExtrude(ref(part, circle), 30.0, 0.0, hsf.AddNewDirectionByCoord(0, 0, 1)), "Tube")
off = add_gsd(part, gs, hsf.AddNewOffset(ref(part, ext), 2.0, True, 0.01), "Tube_Offset")
sweep = add_gsd(part, gs, hsf.AddNewSweepExplicit(ref(part, profile_sketch), ref(part, guide_curve)), "Sweep")

spline = hsf.AddNewSpline()
for p in (a, b, c):
    spline.AddPoint(ref(part, p))
add_gsd(part, gs, spline, "Spline")

loft = hsf.AddNewLoft()
loft.AddSectionToLoft(ref(part, section_1), 1, None)         # None -> NOTHING if it raises
loft.AddSectionToLoft(ref(part, section_2), 1, None)
add_gsd(part, gs, loft, "Loft")

fill = hsf.AddNewFill()
for curve in (e1, e2, e3, e4):
    fill.AddBound(ref(part, curve))
add_gsd(part, gs, fill, "Fill")

inter = add_gsd(part, gs, hsf.AddNewIntersection(ref(part, ext), ref(part, cut)), "Intersect")
proj = add_gsd(part, gs, hsf.AddNewProject(ref(part, spline), ref(part, ext)), "Projection")
trim = add_gsd(part, gs, hsf.AddNewHybridTrim(ref(part, ext), 1, ref(part, surface), 1), "Trim")
moved = add_gsd(part, gs, hsf.AddNewTranslate(ref(part, ext), hsf.AddNewDirectionByCoord(1, 0, 0), 50.0), "Translate")
turned = add_gsd(part, gs, hsf.AddNewRotate(ref(part, ext), ref(part, z_axis), 45.0), "Rotate")
mirror = add_gsd(part, gs, hsf.AddNewSymmetry(ref(part, ext), ref(part, part.OriginElements.PlaneYZ)), "Symmetry")
helix = add_gsd(part, gs, hsf.AddNewHelix(ref(part, z_axis), False, ref(part, a), 5.0, 50.0, False, 0.0, 0.0, False), "Helix")
```

### D. Parametric box (sketch constraints + user parameters + formulas)

```python
from catia_helpers import *

catia = get_catia()
doc = catia.Documents.Add("Part")
part = doc.Part
body = part.MainBody
part.InWorkObject = body
params, rel = part.Parameters, part.Relations
box_l = params.CreateDimension("Box_L", "LENGTH", 100.0)
box_w = params.CreateDimension("Box_W", "LENGTH", 60.0)
box_h = params.CreateDimension("Box_H", "LENGTH", 20.0)

sk = new_sketch(part, body.Sketches, part.OriginElements.PlaneXY, AXIS_XY)
f2d = sk.OpenEdition()
bottom, right, top, left = rectangle(f2d, 0, 0, 100, 60)
csts = sk.Constraints
for line in (bottom, top):
    csts.AddMonoEltCst(catCstTypeHorizontality, ref(part, line))
for line in (right, left):
    csts.AddMonoEltCst(catCstTypeVerticality, ref(part, line))
c_len = csts.AddMonoEltCst(catCstTypeLength, ref(part, bottom))
c_len.Dimension.Value = 100.0
c_wid = csts.AddMonoEltCst(catCstTypeLength, ref(part, right))
c_wid.Dimension.Value = 60.0
sk.CloseEdition()

pad = part.ShapeFactory.AddNewPad(sk, 20.0)
rel.CreateFormula("f_L", "", c_len.Dimension, "Box_L")
rel.CreateFormula("f_W", "", c_wid.Dimension, "Box_W")
rel.CreateFormula("f_H", "", pad.FirstLimit.Dimension, "Box_H")
update(part)

box_l.Value = 150.0          # drive the model
update(part)
```

### E. Assembly: base plate + block, positioned and constrained

```python
import os
from catia_helpers import *

catia = get_catia()
catia.DisplayFileAlerts = False
asm_doc = catia.Documents.Add("Product")
root = asm_doc.Product
root.PartNumber = "BRACKET_ASM"
prods = root.Products


def make_block(inst, lx, ly, lz):
    part = inst.ReferenceProduct.Parent.Part
    body = part.MainBody
    part.InWorkObject = body
    sk = new_sketch(part, body.Sketches, part.OriginElements.PlaneXY, AXIS_XY)
    f2d = sk.OpenEdition()
    rectangle(f2d, 0, 0, lx, ly)
    sk.CloseEdition()
    part.ShapeFactory.AddNewPad(sk, lz)
    update(part)


base = prods.AddNewComponent("Part", "BASE_PLATE")
block = prods.AddNewComponent("Part", "BLOCK")
make_block(base, 200, 100, 10)
make_block(block, 40, 40, 40)

block.Position.SetComponents((1, 0, 0, 0, 1, 0, 0, 0, 1, 80, 30, 10))   # rough placement

csts = root.Connections("CATIAConstraints")
rp = root.PartNumber


def asm_ref(inst, element):
    return root.CreateReferenceFromName(f"{rp}/{inst.Name}/!{element}")


csts.AddMonoEltCst(catCstTypeReference,
                   root.CreateReferenceFromName(f"{rp}/{base.Name}/!{rp}/{base.Name}/"))  # fix ⚠ verify
for plane, offset in (("xy plane", 10.0), ("yz plane", 80.0), ("zx plane", 30.0)):
    cst = csts.AddBiEltCst(catCstTypeDistance, asm_ref(base, plane), asm_ref(block, plane))
    cst.Dimension.Value = offset
root.Update()

out = r"C:\work\bracket"
os.makedirs(out, exist_ok=True)
for inst in (base, block):
    inst.ReferenceProduct.Parent.SaveAs(os.path.join(out, inst.PartNumber + ".CATPart"))
asm_doc.SaveAs(os.path.join(out, "BRACKET_ASM.CATProduct"))
```

### F. Walk an assembly and print a BOM

```python
from collections import Counter
from catia_helpers import *

catia = get_catia()
root = catia.ActiveDocument.Product
root.ApplyWorkMode(DESIGN_MODE)
qty = Counter()


def walk(prod, level=0):
    for i in range(1, prod.Products.Count + 1):
        child = prod.Products.Item(i)
        qty[child.PartNumber] += 1
        try:
            path = child.ReferenceProduct.Parent.FullName
        except pywintypes.com_error:
            path = "(not loaded)"
        print("  " * level + f"{child.Name:30} {child.PartNumber:20} {path}")
        walk(child, level + 1)


walk(root)
for pn, n in sorted(qty.items()):
    print(f"{n:4} x {pn}")
```

---

## 16. Errors and what they usually mean

| Error (HRESULT) | Typical cause | Fix |
|---|---|---|
| `-2147352567` DISP_E_EXCEPTION, text "The method Update failed" | invalid feature: open/self-intersecting profile, pocket cutting air, wrong split side, fillet too large, broken reference | update features one by one with `update(part, f)`; check the sketch is closed; flip direction/side |
| `-2147352567` with "…failed" on an `AddNew…` call | wrong input type, e.g. an object where a Reference is required | wrap the input in `ref(part, obj)`; check the signature in this workbook |
| `-2147352571` DISP_E_TYPEMISMATCH | Reference vs object mix-up; `None` for an object argument; list where an array is expected | `ref()`; `NOTHING`; tuple |
| `-2147352573` DISP_E_MEMBERNOTFOUND / `AttributeError: <unknown>.X` | method or property does not exist on **this** object (wrong factory, misspelled, hallucinated) | check sections 9–14 or `com_type(catia, obj)` |
| `-2147352561` DISP_E_PARAMNOTOPTIONAL | missing argument, or an output-array method called directly | pass all arguments; use `get_array` |
| `-2147352562` DISP_E_BADPARAMCOUNT | wrong number of arguments | compare with the signature / recorded macro |
| `-2147418111` RPC_E_CALL_REJECTED | CATIA busy or a modal dialog is open | close dialogs; retry after a short wait |
| `-2147221021` MK_E_UNAVAILABLE (GetActiveObject) | CATIA not running, or a different elevation level | start CATIA; run Python at the same privilege level |
| `-2147221005` CO_E_CLASSSTRING ("Invalid class string") | CATIA not registered for COM | `CNEXT.exe /regserver` as admin |
| Script runs but nothing appears in the tree | GSD shape never appended | `geo_set.AppendHybridShape(shape)` |
| Feature appears in the wrong place / body | wrong `InWorkObject` | set `part.InWorkObject = body` before creating it |

---

## 17. Common wrong code → correct code

| Wrong (hallucinated) | Correct |
|---|---|
| `catia.Documents.Add("CATPart")` | `catia.Documents.Add("Part")` |
| `part.Bodies[0]` | `part.MainBody` or `part.Bodies.Item(1)` |
| `part.AddPad(...)`, `body.Pad(...)` | `part.ShapeFactory.AddNewPad(sketch, 20.0)` |
| `sketch.AddLine(...)`, `sketch.CreateLine(...)` | `f2d = sketch.OpenEdition(); f2d.CreateLine(h1, v1, h2, v2)` |
| `f2d.CreateRectangle(...)` | 4 connected lines (`rectangle()`) |
| `f2d.CreateCircle(cx, cy, r)` for a full circle | `f2d.CreateClosedCircle(cx, cy, r)` |
| `f2d.CreateCircle(…, 0, 90)` (degrees) | radians: `0, math.pi / 2` |
| `pad.Length = 20`, `pad.Height = 20` | `pad.FirstLimit.Dimension.Value = 20` |
| `pocket.ThroughAll = True` | `pocket.FirstLimit.LimitMode = catUpToLastLimit` |
| `hole.Diameter = 8` | `hole.Diameter.Value = 8` |
| `hsf.AddNewPoint(x, y, z)` | `hsf.AddNewPointCoord(x, y, z)` |
| `hsf.AddNewLine(p1, p2)` | `hsf.AddNewLinePtPt(ref(part, p1), ref(part, p2))` |
| `hsf.AddNewPlane(...)` | `AddNewPlaneOffset`, `AddNewPlane3Points`, … |
| `hsf.AddNewCircle(center, r)` | `hsf.AddNewCircleCtrRad(ref(part, center), ref(part, support), False, r)` |
| `hsf.AddNewExtrude(curve, 20)` | `hsf.AddNewExtrude(ref(part, curve), 20.0, 0.0, direction)` |
| `hsf.AddNewSplit(...)` | `hsf.AddNewHybridSplit(...)` (GSD); `sf.AddNewSplit` is the solid split |
| `hsf.AddNewPad(...)` | Pad is `part.ShapeFactory`, not `HybridShapeFactory` |
| GSD shape created but never appended | `gs.AppendHybridShape(shape)` |
| `win32com.client.constants.catCstTypeOn` | `catCstTypeOn = 2` (section 5) |
| `products.Add(...)`, `products.AddPart(...)` | `products.AddNewComponent("Part", pn)` / `AddComponentsFromFiles((path,), "All")` |
| `instance.Part` | `instance.ReferenceProduct.Parent.Part` |
| `product.Constraints` | `product.Connections("CATIAConstraints")` |
| `x, y, z = point.GetCoordinates()` | `get_array(catia, point, "GetCoordinates", 3)` |
| `doc.SaveAs(r"C:\work\part")` | include the extension `.CATPart` / `.CATProduct` |

---

## 18. Pre-output checklist and prompt template

Before returning a script, check:

- [ ] `from catia_helpers import *` (or the helpers are inlined) and `get_catia()` is used.
- [ ] Every collection access is `.Item(1…Count)` or `.Item("name")`.
- [ ] Every enum is an integer constant from section 5.
- [ ] Factory inputs are References (`ref(part, x)`), except the documented object-taking methods.
- [ ] `part.InWorkObject = body` is set before Part Design features.
- [ ] Every GSD shape is appended (`add_gsd`) and updated before it is used as an input.
- [ ] Sketch geometry and constraints sit between `OpenEdition()` and `CloseEdition()`; profiles are closed.
- [ ] Sketch coordinates are (H, V) for the chosen plane; `SetAbsoluteAxisData` is called.
- [ ] Units are mm / degrees (Factory2D arcs in radians).
- [ ] Output-array methods use `get_array`.
- [ ] Updates are wrapped in try/except with the feature name reported.
- [ ] No method name is used that is absent from this workbook. If one was needed, say so and ask
      for a recorded macro.

**Prompt template:**

```text
You write Python 3 scripts that drive CATIA V5 through its COM API with pywin32.
Use ONLY the objects, methods, signatures and constants in the CATIA workbook provided.
Import everything from catia_helpers.py (workbook section 5) and follow the golden rules
(section 1) and the checklist (section 18). If an operation is not covered, say so and ask me
to record it with Tools > Macro > Start Recording and paste the macro - do not guess names.

Task: <what to build, workbench (Part Design / GSD / Assembly), dimensions in mm,
which plane or element each feature starts from, file path to save to>
```
